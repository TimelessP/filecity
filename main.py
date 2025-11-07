"""
FileCIty: A 3D Cyberpunk File System Browser
FastAPI backend for serving file system data and 3D visualization
"""

import argparse
import os
import json
import math
import mimetypes
import shutil
import subprocess
from threading import Lock, Thread, Event
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    return normalized in {"1", "true", "t", "yes", "y", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _resolve_root_dir(path_str: str) -> Path:
    candidate = Path(path_str).expanduser()
    resolved = candidate.resolve()
    if not resolved.exists():
        raise ValueError(f"Configured root directory '{candidate}' does not exist")
    if not resolved.is_dir():
        raise ValueError(f"Configured root directory '{candidate}' is not a directory")
    if not os.access(resolved, os.R_OK):
        raise ValueError(f"Configured root directory '{candidate}' is not readable")
    return resolved


def _determine_root_dir() -> Path:
    configured = os.getenv("FILECITY_ROOT_DIR")
    if configured:
        try:
            return _resolve_root_dir(configured)
        except ValueError as exc:
            print(f"Warning: {exc}; falling back to the user's home directory.")
    return _resolve_root_dir(str(Path.home()))



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
    preview_available: bool = True
    preview_unavailable_reason: Optional[str] = None


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


ROOT_DIR = _determine_root_dir()
HOST = os.getenv("FILECITY_HOST", "0.0.0.0")
PORT = _env_int("FILECITY_PORT", 8000)
RELOAD = _env_bool("FILECITY_RELOAD", True)
LSOF_REQUESTED = _env_bool("FILECITY_LSOF_ENABLED", True)
LSOF_BINARY_PRESENT = shutil.which("lsof") is not None
LSOF_ENABLED = LSOF_REQUESTED and LSOF_BINARY_PRESENT

PROCESS_MONITOR_LOCK = Lock()
PROCESS_MONITOR = None


@app.on_event("startup")
async def _startup_monitor() -> None:
    ensure_process_monitor()


@app.on_event("shutdown")
async def _shutdown_monitor() -> None:
    stop_process_monitor()


class LsofMonitor:
    """Background task that periodically snapshots lsof output for the configured root."""

    def __init__(self, root: Path, interval: float = 2.0) -> None:
        self.root = root
        self.interval = max(0.5, float(interval))
        self._lock = Lock()
        self._stop_event = Event()
        self._thread: Optional[Thread] = None
        self._snapshot: Dict[str, OpenFileEntry] = {}
        self._last_warning_emitted = False

    def is_running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive()

    def start(self) -> None:
        if self.is_running():
            return
        self._stop_event.clear()
        thread = Thread(target=self._run, name="FileCityLsofMonitor", daemon=True)
        self._thread = thread
        thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread:
            thread.join(timeout=1.5)
        self._thread = None
        with self._lock:
            self._snapshot = {}
        self._last_warning_emitted = False

    def snapshot(self) -> Dict[str, OpenFileEntry]:
        with self._lock:
            return {path: entry.copy(deep=True) for path, entry in self._snapshot.items()}

    def get_entries_for_directory(self, directory: Path) -> List[OpenFileEntry]:
        target_relative = _absolute_to_client_path(directory)
        snapshot = self.snapshot()
        if target_relative == '/':
            prefix = ''
        else:
            prefix = f"{target_relative.rstrip('/')}/"
        selection: List[OpenFileEntry] = []
        for path, entry in snapshot.items():
            if path == target_relative or path.startswith(prefix):
                selection.append(entry.copy(deep=True))
        selection.sort(key=lambda item: item.path.lower())
        return selection

    def _run(self) -> None:
        while not self._stop_event.is_set():
            snapshot = self._collect_snapshot()
            if snapshot is not None:
                with self._lock:
                    self._snapshot = snapshot
            if self._stop_event.wait(self.interval):
                break

    def _collect_snapshot(self) -> Optional[Dict[str, OpenFileEntry]]:
        try:
            result = subprocess.run(
                ["lsof", "-Fn"],
                capture_output=True,
                text=True,
                check=False,
                timeout=5
            )
        except FileNotFoundError:
            if not self._last_warning_emitted:
                print("Warning: lsof not found; disabling process monitoring cache.")
                self._last_warning_emitted = True
            return {}
        except subprocess.TimeoutExpired:
            if not self._last_warning_emitted:
                print("Warning: lsof timed out while collecting open files.")
                self._last_warning_emitted = True
            return None

        if result.returncode not in (0, 1):
            if not self._last_warning_emitted:
                detail = result.stderr.strip() or f"lsof exited with code {result.returncode}"
                print(f"Warning: {detail}")
                self._last_warning_emitted = True
            return None

        if self._last_warning_emitted:
            self._last_warning_emitted = False

        entries: Dict[str, Dict[str, Optional[str]]] = {}

        for line in result.stdout.splitlines():
            if not line or not line.startswith('n'):
                continue
            raw_path = line[1:].strip()
            if not raw_path:
                continue
            abs_path = Path(raw_path)
            try:
                abs_path = abs_path.resolve(strict=False)
            except OSError:
                continue
            if abs_path.is_dir():
                continue
            if not _is_path_within_root(abs_path):
                continue
            try:
                client_path = _absolute_to_client_path(abs_path)
            except HTTPException:
                continue

            resolved_path = abs_path
            try:
                resolved_path = abs_path.resolve(strict=False)
            except OSError:
                resolved_path = abs_path
            resolved_client: Optional[str] = None
            if _is_path_within_root(resolved_path):
                try:
                    resolved_client = _absolute_to_client_path(resolved_path)
                except HTTPException:
                    resolved_client = None

            slot = entries.setdefault(client_path, {"resolved_path": resolved_client})
            if resolved_client and not slot.get("resolved_path"):
                slot["resolved_path"] = resolved_client

        snapshot: Dict[str, OpenFileEntry] = {}
        for client_path, info in entries.items():
            process = OpenFileProcess(pid=-1, command="")
            snapshot[client_path] = OpenFileEntry(
                path=client_path,
                resolved_path=info.get("resolved_path"),
                processes=[process]
            )

        return snapshot


def ensure_process_monitor() -> Optional[LsofMonitor]:
    """Create or reuse the background lsof monitor when process tracking is enabled."""
    global PROCESS_MONITOR
    if not LSOF_ENABLED:
        return None

    monitor = PROCESS_MONITOR
    if monitor and monitor.is_running():
        return monitor

    with PROCESS_MONITOR_LOCK:
        monitor = PROCESS_MONITOR
        if monitor is None:
            monitor = LsofMonitor(ROOT_DIR)
            PROCESS_MONITOR = monitor
        monitor.start()
        return monitor


def get_process_monitor() -> Optional[LsofMonitor]:
    return PROCESS_MONITOR


def stop_process_monitor() -> None:
    global PROCESS_MONITOR
    monitor = PROCESS_MONITOR
    if monitor:
        monitor.stop()
    PROCESS_MONITOR = None


def _is_path_within_root(path: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(ROOT_DIR)
        return True
    except ValueError:
        return False


FAVOURITES_FILE = Path("data/favourites.json")
FAVOURITES_LOCK = Lock()


def _normalize_relative_path(value: Optional[str]) -> Path:
    if value is None:
        return Path()
    text = str(value).strip()
    if text in {"", ".", "./"}:
        return Path()
    text = text.replace("\\", "/")
    if text in {"/", "./", "."}:
        return Path()
    if len(text) >= 2 and text[1] == ':' and text[0].isalpha():
        raise HTTPException(status_code=400, detail="Invalid path")
    if text.startswith("/"):
        text = text.lstrip("/")
        if not text:
            return Path()
    parts: List[str] = []
    for part in text.split('/'):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                raise HTTPException(status_code=403, detail="Access denied")
            parts.pop()
        else:
            parts.append(part)
    return Path(*parts)


def _relative_path_to_string(path: Path) -> str:
    if not path.parts:
        return "/"
    return "/".join(path.parts)


def _client_path_to_absolute(value: Optional[str]) -> Path:
    relative_path = _normalize_relative_path(value)
    absolute = (ROOT_DIR / relative_path).resolve(strict=False)
    if not _is_path_within_root(absolute):
        raise HTTPException(status_code=403, detail="Access outside the configured root directory is denied")
    return absolute


def _absolute_to_client_path(path: Path) -> str:
    resolved = path.resolve(strict=False)
    if not _is_path_within_root(resolved):
        raise HTTPException(status_code=403, detail="Access outside the configured root directory is denied")
    try:
        relative = resolved.relative_to(ROOT_DIR)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="Access outside the configured root directory is denied") from exc
    return _relative_path_to_string(relative)


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
                if not isinstance(data, list):
                    return []
                favourites: List[str] = []
                for item in data:
                    try:
                        relative = _normalize_relative_path(str(item))
                    except HTTPException:
                        continue
                    entry = _relative_path_to_string(relative)
                    if entry not in favourites:
                        favourites.append(entry)
                return favourites
        except json.JSONDecodeError:
            return []


def save_favourites(paths: List[str]) -> None:
    ensure_favourites_file()
    with FAVOURITES_LOCK:
        sanitized: List[str] = []
        for path in paths:
            try:
                relative = _normalize_relative_path(path)
            except HTTPException:
                continue
            entry = _relative_path_to_string(relative)
            if entry not in sanitized:
                sanitized.append(entry)
        sanitized.sort()
        with FAVOURITES_FILE.open("w", encoding="utf-8") as fh:
            json.dump(sanitized, fh, indent=2)


def get_safe_path(requested_path: Optional[str]) -> Path:
    """
    Resolve and validate file path to prevent directory traversal attacks.
    Only allows access to files the current user can access.
    """
    try:
        resolved_path = _client_path_to_absolute(requested_path)
    except HTTPException:
        raise
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid path: {str(exc)}") from exc

    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    if not os.access(resolved_path, os.R_OK):
        raise HTTPException(status_code=403, detail="Access denied")

    return resolved_path


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



def list_open_files_for_directory(directory: Path) -> List[OpenFileEntry]:
    """Return cached open file entries for the given directory."""
    monitor = ensure_process_monitor()
    if not monitor:
        raise HTTPException(status_code=400, detail="Open file inspection is not supported on this system")
    return monitor.get_entries_for_directory(directory)


@app.get("/")
async def root():
    """Serve the main 3D interface"""
    return FileResponse('static/index.html')


@app.get("/api/capabilities")
async def get_capabilities() -> CapabilityResponse:
    """Expose server capability flags for the frontend handshake."""
    return CapabilityResponse(lsof_available=LSOF_ENABLED)


@app.get("/api/browse")
async def browse_directory(path: str = None) -> DirectoryListing:
    """
    Browse directory contents for 3D visualization
    """
    relative_path = _normalize_relative_path(path)
    safe_path = get_safe_path(path)
    
    if not safe_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    
    items = []
    favourite_paths = set(load_favourites())
    
    try:
        for item in safe_path.iterdir():
            try:
                stat_info = item.stat()
                try:
                    client_path = _absolute_to_client_path(item)
                except HTTPException as exc:
                    if exc.status_code == 403:
                        continue
                    raise

                readable = os.access(item, os.R_OK)
                is_regular_file = item.is_file()
                preview_available = True
                preview_unavailable_reason: Optional[str] = None
                if item.is_dir():
                    preview_available = True
                elif not is_regular_file:
                    preview_available = False
                    preview_unavailable_reason = "Unsupported file type"
                elif not readable:
                    preview_available = False
                    preview_unavailable_reason = "Permission denied"

                if preview_available and not item.is_dir():
                    first_segment = client_path.split('/', 1)[0]
                    if first_segment == "proc":
                        preview_available = False
                        preview_unavailable_reason = "Ephemeral process file"
                
                # Get file info
                file_info = FileInfo(
                    name=item.name,
                    path=client_path,
                    is_directory=item.is_dir(),
                    size=stat_info.st_size if not item.is_dir() else 0,
                    modified=stat_info.st_mtime,
                    log_size=calculate_log_size(stat_info.st_size) if not item.is_dir() else 1.0,
                    mime_type=mimetypes.guess_type(str(item))[0] if not item.is_dir() else None,
                    is_favourite=client_path in favourite_paths,
                    preview_available=preview_available,
                    preview_unavailable_reason=preview_unavailable_reason
                )
                
                items.append(file_info)
                
            except (OSError, PermissionError):
                # Skip files we can't access
                continue
    
    except (OSError, PermissionError) as e:
        raise HTTPException(status_code=403, detail=f"Cannot access directory: {str(e)}")
    
    # Get parent directory
    if not relative_path.parts:
        parent = None
    else:
        parent_path = Path(*relative_path.parts[:-1])
        parent = _relative_path_to_string(parent_path)
    
    return DirectoryListing(
        path=_relative_path_to_string(relative_path),
        parent=parent,
        items=items
    )


@app.get("/api/file-hex")
async def fetch_file_hex(path: str, max_bytes: int = 256) -> HexPreview:
    """Fetch structured hex dump lines for a file"""
    relative_path = _normalize_relative_path(path)
    safe_path = get_safe_path(path)

    if not safe_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    lines = get_hex_preview(safe_path, max_bytes=max_bytes)
    if lines is None:
        raise HTTPException(status_code=404, detail="Unable to read file contents")

    return HexPreview(path=_relative_path_to_string(relative_path), lines=lines)


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
    relative_path = _normalize_relative_path(request.path)
    relative_str = _relative_path_to_string(relative_path)
    favourites = set(load_favourites())

    if request.favourite:
        get_safe_path(request.path)
        favourites.add(relative_str)
    else:
        favourites.discard(relative_str)

    sorted_favs = sorted(favourites)
    save_favourites(sorted_favs)
    return sorted_favs


@app.get("/api/open-files")
async def get_open_files(directory: Optional[str] = None) -> List[OpenFileEntry]:
    target_path = get_safe_path(directory)
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return list_open_files_for_directory(target_path)


@app.get("/api/file-info")
async def get_file_info(path: str) -> FileInfo:
    """
    Get detailed information about a specific file
    """
    relative_path = _normalize_relative_path(path)
    safe_path = get_safe_path(path)

    try:
        stat_info = safe_path.stat()
        favourite_paths = set(load_favourites())
        relative_str = _relative_path_to_string(relative_path)

        is_directory = safe_path.is_dir()
        display_name = safe_path.name
        if safe_path == ROOT_DIR:
            display_name = ROOT_DIR.name or "/"
        if not display_name:
            display_name = "/"

        mime_type = None if is_directory else mimetypes.guess_type(str(safe_path))[0]
        file_info = FileInfo(
            name=display_name,
            path=relative_str,
            is_directory=is_directory,
            size=stat_info.st_size if not is_directory else 0,
            modified=stat_info.st_mtime,
            log_size=calculate_log_size(stat_info.st_size) if not is_directory else 1.0,
            mime_type=mime_type,
            is_favourite=relative_str in favourite_paths
        )

        if not safe_path.is_dir():
            file_info.hex_preview = get_hex_preview(safe_path, max_bytes=512)

        return file_info

    except (OSError, PermissionError) as e:
        raise HTTPException(status_code=403, detail=f"Cannot access file: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description="Run the FileCity server")
    parser.add_argument(
        "--root-dir",
        dest="root_dir",
        default=str(ROOT_DIR),
        help="Restrict browsing to this directory (default: FILECITY_ROOT_DIR or the user's home directory)",
    )
    parser.add_argument(
        "--host",
        dest="host",
        default=HOST,
        help="Host interface to bind (default: FILECITY_HOST or 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        dest="port",
        type=int,
        default=PORT,
        help="Port to bind (default: FILECITY_PORT or 8000)",
    )
    parser.add_argument(
        "--reload",
        dest="reload",
        action="store_true",
        default=RELOAD,
        help="Enable auto-reload (default: FILECITY_RELOAD)",
    )
    parser.add_argument(
        "--no-reload",
        dest="reload",
        action="store_false",
        help="Disable auto-reload",
    )
    parser.add_argument(
        "--lsof-enabled",
        dest="lsof_enabled",
        action="store_true",
        default=LSOF_REQUESTED,
        help="Enable lsof-based process monitoring (default: FILECITY_LSOF_ENABLED)",
    )
    parser.add_argument(
        "--no-lsof",
        dest="lsof_enabled",
        action="store_false",
        help="Disable lsof-based process monitoring",
    )
    args = parser.parse_args()

    try:
        ROOT_DIR = _resolve_root_dir(str(args.root_dir))
    except ValueError as exc:
        parser.error(str(exc))

    os.environ["FILECITY_ROOT_DIR"] = str(ROOT_DIR)
    HOST = args.host
    PORT = args.port
    RELOAD = args.reload
    LSOF_REQUESTED = args.lsof_enabled
    LSOF_ENABLED = LSOF_REQUESTED and LSOF_BINARY_PRESENT
    if LSOF_REQUESTED and not LSOF_ENABLED:
        print("Warning: lsof-based monitoring requested but lsof is not available on this system. Feature disabled.")

    print("Starting FileCity server...")
    print(f"Root directory: {ROOT_DIR}")
    print(f"Process monitoring enabled: {'yes' if LSOF_ENABLED else 'no'}")
    print(f"Navigate to http://{HOST}:{PORT} to enter the cyberpunk file matrix!")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=RELOAD)