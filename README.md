# FileCity

FileCity is a stylised 3D cyberpunk interface for exploring a local file system. The world is rendered with Three.js, turning directories into glowing towers and file previews into volumetric cubes that hover above each structure.

![Downtown vista](screenshots/Screenshot%20from%202025-11-04%2023-40-24.png)
![Preview focus](screenshots/Screenshot%20from%202025-11-04%2023-41-08.png)
![Media playback glow](screenshots/Screenshot%20from%202025-11-04%2023-42-22.png)

## Features
- Dynamic city layout that visualises folders as buildings with procedurally textured pavements.
- Pointer-lock flight controls with roll, custom zoom, and camera snap-to-preview behaviour.
- Real-time media previews for images, audio, video, and hex-dumped binaries.
- Favourite tagging, hidden file toggling, and persistent navigation history.
- Reactive pavements that glow orange while media plays and shift to violet while paused.
- Live process indicators fed by a background `lsof` monitor, highlighting files and directories with active processes.
- Media playback that survives directory navigation so long as the underlying file remains available.

## Controls
- `Mouse` look, `WASD` strafe/advance, `SPACE` / `CTRL` ascend or descend.
- `Q` / `E` roll, `SHIFT` precision throttle, `C` level the horizon.
- `Mouse Wheel` move forward/backward, `Left Click` enter directories, `Right Click` focus previews, hold for context actions.
- `Backspace` or `U` go to parent, `H` home, `R` refresh directory.
- `V` toggle hidden entries (media keeps playing), `F` toggle favourite, `.` cycle preview detail.
- `P` stop media, `Enter` (or `Numpad Enter`) pause/resume playback.
- `[` / `]` skip ±10 s, hold `SHIFT` for ±60 s stepping.

## Running Locally
1. Install dependencies: `pip install -r requirements.txt`.
2. Launch the backend: `python main.py` (defaults to FastAPI on port 8000; use `--root-dir` or environment variables to override settings).
3. Open a browser at `http://localhost:8000` (or your configured host/port) to enter FileCity.

## Development Notes
- Static assets live under `static/`; primary client logic is in `static/filecity.js`.
- API routes serving directory, preview, and process data are defined in the FastAPI app (`main.py`).
- When updating preview logic or media handling, keep `setBuildingMediaState` and the media persistence helpers in sync so pavements reflect the correct status.

## License
FileCity is released under the MIT License. See the `LICENSE` file for full terms.
