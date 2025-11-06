"""
FileCIty: A 3D Cyberpunk File System Browser
FastAPI backend for serving file system data and 3D visualization
"""

import os
import json
import math
import mimetypes
import shutil
import subprocess
from threading import Lock
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# Pydantic models for API responses
class HexLine(BaseModel):
    offset: str
    hex: str
    ascii: str


class FileInfo(BaseModel):
    name: str
    path: str
    is_directory: bool
    size: int
    modified: float
    mime_type: Optional[str] = None
    log_size: float  # log-normalized size for building height
    hex_preview: Optional[List[HexLine]] = None  # Optional detailed preview
    is_favourite: Optional[bool] = False


class DirectoryListing(BaseModel):
    path: str
    parent: Optional[str]
    items: List[FileInfo]


class HexPreview(BaseModel):
    path: str
    lines: List[HexLine]


class FavouriteRequest(BaseModel):
    path: str
    favourite: bool


class OpenFileProcess(BaseModel):
    pid: int
    command: str


class OpenFileEntry(BaseModel):
    path: str
    resolved_path: Optional[str] = None
    processes: List[OpenFileProcess]


class CapabilityResponse(BaseModel):
    lsof_available: bool


# Initialize FastAPI app
app = FastAPI(
    title="FileCity",
    description="3D Cyberpunk File System Browser",
    version="1.0.0"
)

# Add CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


FAVOURITES_FILE = Path("data/favourites.json")
FAVOURITES_LOCK = Lock()
LSOF_AVAILABLE = shutil.which("lsof") is not None


def ensure_favourites_file() -> None:
    FAVOURITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not FAVOURITES_FILE.exists():
        with FAVOURITES_FILE.open("w", encoding="utf-8") as fh:
            json.dump([], fh)


def load_favourites() -> List[str]:
    ensure_favourites_file()
    with FAVOURITES_LOCK:
        try:
            with FAVOURITES_FILE.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    return [str(Path(item)) for item in data]
                return []
        except json.JSONDecodeError:
            return []


def save_favourites(paths: List[str]) -> None:
    ensure_favourites_file()
    with FAVOURITES_LOCK:
        with FAVOURITES_FILE.open("w", encoding="utf-8") as fh:
            json.dump(paths, fh, indent=2)


def get_safe_path(requested_path: str) -> Path:
    """
    Resolve and validate file path to prevent directory traversal attacks.
    Only allows access to files the current user can access.
    """
    if not requested_path:
        requested_path = str(Path.home())
    
    try:
        # Resolve the path and ensure it exists
        resolved_path = Path(requested_path).resolve()
        
        # Basic security: ensure the path exists and is accessible
        if not resolved_path.exists():
            raise HTTPException(status_code=404, detail="Path not found")
        
        # Check if we have read access
        if not os.access(resolved_path, os.R_OK):
            raise HTTPException(status_code=403, detail="Access denied")
        
        return resolved_path
    
    except (OSError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {str(e)}")


def get_hex_preview(file_path: Path, max_bytes: int = 256) -> Optional[List[HexLine]]:
    """
    Generate structured hex dump preview of file for texture generation.
    Returns list of offset/hex/ascii rows for the first max_bytes of the file.
    """
    try:
        if not file_path.is_file():
            return None

        with open(file_path, "rb") as f:
            data = f.read(max_bytes)

        hex_lines: List[HexLine] = []
        for offset in range(0, len(data), 16):
            chunk = data[offset : offset + 16]
            hex_part = " ".join(f"{byte:02x}" for byte in chunk)
            ascii_part = "".join(chr(byte) if 32 <= byte < 127 else "." for byte in chunk)
            hex_lines.append(
                HexLine(
                    offset=f"{offset:08x}",
                    hex=hex_part.ljust(47),
                    ascii=ascii_part,
                )
            )

        return hex_lines

    except (OSError, PermissionError):
        return None


def calculate_log_size(size: int) -> float:
    """
    Calculate log-normalized file size for building height.
    Returns value between 0.1 and 10.0 for visual scaling.
    """
    if size <= 0:
        return 0.1
    
    # Log base 10 with some scaling for visual appeal
    log_size = math.log10(max(1, size))
    # Normalize to reasonable building heights (0.1 to 10.0 units)
    normalized = max(0.1, min(10.0, log_size / 2.0))
    return normalized


def _normalize_lsof_path(raw_path: str, directory: Path, directory_resolved: Path) -> Optional[tuple[str, str]]:
    """Clean and normalize an lsof path value, restricting it to direct children of directory."""
    if not raw_path:
        return None

    cleaned = raw_path.split(' (deleted)', 1)[0].strip()
    if not cleaned:
        return None

    dir_str = str(directory_resolved)
    if not os.path.isabs(cleaned):
        absolute_str = os.path.normpath(os.path.join(dir_str, cleaned))
    else:
        absolute_str = os.path.normpath(cleaned)

    try:
        relative = os.path.relpath(absolute_str, dir_str)
    except ValueError:
        return None

    if relative == '.':
        return None
    if relative.startswith('..'):
        return None
    if os.sep in relative:
        return None

    resolved_str = os.path.realpath(absolute_str)
    return absolute_str, resolved_str


def list_open_files_for_directory(directory: Path) -> List[OpenFileEntry]:
    """Invoke lsof and return open files directly within the given directory."""
    if not LSOF_AVAILABLE:
        raise HTTPException(status_code=400, detail="Open file inspection is not supported on this system")
    command = ["lsof", "-Fpcfn", "+d", str(directory)]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=5
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail="Open file inspection is not supported on this system") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Timed out while running lsof") from exc

    # lsof returns 1 when no matches are found.
    if result.returncode not in (0, 1):
        detail = result.stderr.strip() or "Unable to inspect open files"
        raise HTTPException(status_code=500, detail=detail)

    directory_resolved = directory.resolve(strict=False)
    entries: Dict[str, Dict[str, object]] = {}
    current_pid: Optional[int] = None
    current_command: Optional[str] = None

    for line in result.stdout.splitlines():
        if not line:
            continue
        field = line[0]
        value = line[1:]

        if field == 'p':
            try:
                current_pid = int(value.strip())
            except ValueError:
                current_pid = None
            current_command = None
        elif field == 'c':
            current_command = value.strip()
        elif field == 'n':
            if current_pid is None:
                continue
            normalized = _normalize_lsof_path(value, directory, directory_resolved)
            if not normalized:
                continue
            absolute_str, resolved_str = normalized
            entry = entries.setdefault(
                absolute_str,
                {
                    "path": absolute_str,
                    "resolved_path": resolved_str,
                    "processes": []
                }
            )
            processes: List[Dict[str, object]] = entry["processes"]  # type: ignore[assignment]
            if not any(proc.get("pid") == current_pid for proc in processes):
                processes.append({
                    "pid": current_pid,
                    "command": current_command or ""
                })

    open_files: List[OpenFileEntry] = []
    for entry in entries.values():
        processes_data = entry["processes"]  # type: ignore[assignment]
        if not processes_data:
            continue
        open_files.append(
            OpenFileEntry(
                path=str(entry["path"]),
                resolved_path=str(entry["resolved_path"]),
                processes=[OpenFileProcess(**proc) for proc in processes_data]
            )
        )

    open_files.sort(key=lambda item: item.path.lower())

    return open_files


@app.get("/")
async def root():
    """Serve the main 3D interface"""
    return FileResponse('static/index.html')


@app.get("/api/capabilities")
async def get_capabilities() -> CapabilityResponse:
    """Expose server capability flags for the frontend handshake."""
    return CapabilityResponse(lsof_available=LSOF_AVAILABLE)


@app.get("/api/browse")
async def browse_directory(path: str = None) -> DirectoryListing:
    """
    Browse directory contents for 3D visualization
    """
    if path is None:
        path = str(Path.home())
    
    safe_path = get_safe_path(path)
    
    if not safe_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    
    items = []
    favourite_paths = set(load_favourites())
    
    try:
        for item in safe_path.iterdir():
            try:
                stat_info = item.stat()
                
                # Get file info
                file_info = FileInfo(
                    name=item.name,
                    path=str(item),
                    is_directory=item.is_dir(),
                    size=stat_info.st_size if not item.is_dir() else 0,
                    modified=stat_info.st_mtime,
                    log_size=calculate_log_size(stat_info.st_size) if not item.is_dir() else 1.0,
                    mime_type=mimetypes.guess_type(str(item))[0] if not item.is_dir() else None,
                    is_favourite=str(item) in favourite_paths
                )
                
                items.append(file_info)
                
            except (OSError, PermissionError):
                # Skip files we can't access
                continue
    
    except (OSError, PermissionError) as e:
        raise HTTPException(status_code=403, detail=f"Cannot access directory: {str(e)}")
    
    # Get parent directory
    parent = str(safe_path.parent) if safe_path.parent != safe_path else None
    
    return DirectoryListing(
        path=str(safe_path),
        parent=parent,
        items=items
    )


@app.get("/api/file-hex")
async def fetch_file_hex(path: str, max_bytes: int = 256) -> HexPreview:
    """Fetch structured hex dump lines for a file"""
    safe_path = get_safe_path(path)

    if not safe_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    lines = get_hex_preview(safe_path, max_bytes=max_bytes)
    if lines is None:
        raise HTTPException(status_code=404, detail="Unable to read file contents")

    return HexPreview(path=str(safe_path), lines=lines)


@app.get("/api/file-preview")
async def fetch_file_preview(path: str):
    """Stream file contents for media and texture previews."""
    safe_path = get_safe_path(path)

    if not safe_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    media_type = mimetypes.guess_type(str(safe_path))[0] or "application/octet-stream"
    return FileResponse(str(safe_path), media_type=media_type)


@app.get("/api/favourites")
async def get_favourites() -> List[str]:
    return load_favourites()


@app.post("/api/favourites")
async def set_favourite(request: FavouriteRequest) -> List[str]:
    safe_path = str(get_safe_path(request.path))
    favourites = set(load_favourites())

    if request.favourite:
        favourites.add(safe_path)
    else:
        favourites.discard(safe_path)

    sorted_favs = sorted(favourites)
    save_favourites(sorted_favs)
    return sorted_favs


@app.get("/api/open-files")
async def get_open_files(directory: Optional[str] = None) -> List[OpenFileEntry]:
    target_path = get_safe_path(directory or str(Path.home()))
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return list_open_files_for_directory(target_path)


@app.get("/api/file-info")
async def get_file_info(path: str) -> FileInfo:
    """
    Get detailed information about a specific file
    """
    safe_path = get_safe_path(path)
    
    try:
        stat_info = safe_path.stat()
        
        favourite_paths = set(load_favourites())

        file_info = FileInfo(
            name=safe_path.name,
            path=str(safe_path),
            is_directory=safe_path.is_dir(),
            size=stat_info.st_size if not safe_path.is_dir() else 0,
            modified=stat_info.st_mtime,
            log_size=calculate_log_size(stat_info.st_size) if not safe_path.is_dir() else 1.0,
            mime_type=mimetypes.guess_type(str(safe_path))[0] if not safe_path.is_dir() else None,
            is_favourite=str(safe_path) in favourite_paths
        )
        
        # Add hex preview for files
        if not safe_path.is_dir():
            file_info.hex_preview = get_hex_preview(safe_path, max_bytes=512)
        
        return file_info
        
    except (OSError, PermissionError) as e:
        raise HTTPException(status_code=403, detail=f"Cannot access file: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    print("Starting FileCity server...")
    print("Navigate to http://localhost:8000 to enter the cyberpunk file matrix!")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)