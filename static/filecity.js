/**
 * FileCity - 3D Cyberpunk File System Browser (Preview Cube Rewrite)
 * Main JavaScript module handling 3D rendering, navigation, and file system visualization
 */

class FileCity {
    constructor() {
        // Core scene objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Navigation state
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.camera_velocity = new THREE.Vector3();
        this.pitch = 0;
        this.yaw = 0;
        this.roll = 0;
        this.isPointerLocked = false;

        // File system state
        this.currentPath = null;
        this.buildings = [];
        this.allFiles = [];
        this.fileData = [];
        this.showHidden = false;
        this.favourites = new Set();
        this.directoryToken = 0;

        // Preview management
        this.detailCount = 9; // 3x3 grid of detailed buildings
        this.previewCache = new Map();
        this.pendingPreviewLoads = new Set();
        this.previewCubeMaxSize = 2.6;
        this.previewUpdateInterval = 400; // ms
        this.lastPreviewUpdate = 0;
        this.directoryPreviewTexture = null;

        // View state stack
        this.viewStack = [];
        this.pendingViewState = null;
        this.defaultViewState = null;
        this.pendingStackPushPath = null;

    // Grid layout
    this.gridColumns = 8;
    this.gridSpacing = 8;
    this.pavementGeometry = null;
    this.pavementMaterial = null;
    this.pavementTexture = null;

        // Media/file type helpers
        this.imagePreviewExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'apng', 'tif', 'tiff', 'ico']);
        this.audioExtensions = new Set(['mp3', 'ogg', 'oga', 'wav', 'aac', 'm4a', 'flac', 'opus', 'weba']);
        this.videoExtensions = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']);

        // Right-click hold behaviour
        this.rightClickHoldTimer = null;
        this.rightClickHoldTarget = null;
        this.rightClickHoldDelay = 2000;

        // Media playback
        this.activeMedia = null; // 'audio' | 'video'
        this.audioElement = null;
        this.videoElement = null;
        this.videoCanvas = null;
        this.videoCanvasCtx = null;
        this.videoCanvasTexture = null;
        this.mediaBuilding = null;
        this.pendingVideoHandlers = null;

        // Raycasting
        this.raycaster = new THREE.Raycaster();
        this.mouse_normalized = new THREE.Vector2();

        // Colours
        this.colors = {
            directory: 0x00ffff,
            file: 0x00ff00,
            executable: 0xff0080,
            image: 0xffff00,
            text: 0x80ff80,
            grid: 0x004040,
            glow: 0x00ffff,
            favourite: 0xff8c00,
            mediaPaused: 0x9d4dff
        };

        this.init();
    }

    async init() {
        this.updateLoadingProgress(10, "Initializing 3D Engine...");
        this.initThreeJS();
        this.updateLoadingProgress(30, "Setting up cybernet protocols...");

        this.initControls();
        this.updateLoadingProgress(50, "Loading neural interface...");

        this.initMedia();
        this.createScene();
        this.updateLoadingProgress(60, "Syncing favourites cache...");

        await this.loadFavourites();
        this.updateLoadingProgress(70, "Scanning file matrix...");

        await this.loadDirectory();
        this.updateLoadingProgress(90, "Materializing data structures...");

        this.animate();
        this.updateLoadingProgress(100, "FileCity Matrix Online!");

        setTimeout(() => {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('hud').style.display = 'block';
        }, 1000);
    }

    initThreeJS() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000008);
        this.scene.fog = new THREE.Fog(0x000008, 30, 200);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 20);
        this.defaultViewState = this.getCurrentViewState();

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    initControls() {
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
        });
        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
        });

        document.addEventListener('keydown', (event) => {
            if (event.code === 'Backspace' || event.code === 'KeyU') {
                event.preventDefault();
                this.goToParentDirectory();
            }
            if (event.code === 'KeyH') {
                event.preventDefault();
                this.goToHome();
            }
            if (event.code === 'KeyR') {
                event.preventDefault();
                this.reloadCurrentDirectory();
            }
            if (event.code === 'KeyP') {
                event.preventDefault();
                this.stopMedia();
            }
            if (event.code === 'KeyC') {
                event.preventDefault();
                this.roll = 0;
            }
            if (event.code === 'KeyV') {
                event.preventDefault();
                this.toggleHidden();
            }
            if (event.code === 'KeyF') {
                event.preventDefault();
                this.toggleFavouriteUnderCrosshair();
            }
            if (event.code === 'Period') {
                event.preventDefault();
                this.cycleRenderDetail();
            }
            if (event.code === 'BracketLeft') {
                event.preventDefault();
                const offset = event.shiftKey ? -60 : -10;
                this.skipActiveMedia(offset);
            }
            if (event.code === 'BracketRight') {
                event.preventDefault();
                const offset = event.shiftKey ? 60 : 10;
                this.skipActiveMedia(offset);
            }
            if (event.code === 'Enter' || event.code === 'NumpadEnter') {
                event.preventDefault();
                this.toggleMediaPlayback();
            }
        });

        document.addEventListener('click', (event) => {
            if (event.button !== 0) {
                return;
            }
            if (!this.isPointerLocked) {
                this.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === document.body;
            if (!this.isPointerLocked) {
                this.cancelRightClickHold();
            }
        });

        document.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.cancelRightClickHold();
        });

        document.addEventListener('mousedown', (event) => {
            if (event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
                const building = this.getBuildingUnderCrosshair();
                this.focusPreviewUnderCrosshair(building);
                this.startRightClickHold(building);
            } else {
                this.cancelRightClickHold();
            }
        });

        document.addEventListener('mouseup', (event) => {
            if (event.button === 2) {
                event.preventDefault();
                event.stopPropagation();
                this.cancelRightClickHold();
            }
        });

        window.addEventListener('blur', () => {
            this.cancelRightClickHold();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') {
                this.cancelRightClickHold();
            }
        });

        document.addEventListener('mousemove', (event) => {
            if (!this.isPointerLocked) {
                return;
            }
            const sensitivity = 0.0025;
            const cosRoll = Math.cos(this.roll);
            const sinRoll = Math.sin(this.roll);
            const deltaYaw = (-(event.movementX * cosRoll) + (event.movementY * sinRoll)) * sensitivity;
            const deltaPitch = (-(event.movementY * cosRoll) - (event.movementX * sinRoll)) * sensitivity;
            this.yaw += deltaYaw;
            this.pitch += deltaPitch;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        });

        document.addEventListener('wheel', (event) => {
            if (!this.camera) {
                return;
            }
            event.preventDefault();
            const zoomSpeed = 0.0025;
            const delta = -event.deltaY * zoomSpeed;
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
            this.camera.position.addScaledVector(forward, delta);
            this.updateDisplayedCoordinates();
        }, { passive: false });

        document.addEventListener('click', (event) => {
            if (event.button !== 0) {
                return;
            }
            const building = this.getBuildingUnderCrosshair();
            if (!building) {
                return;
            }
            const fileInfo = building.userData.fileInfo;
            if (fileInfo.is_directory) {
                this.pushCurrentViewState();
                this.pendingStackPushPath = fileInfo.path;
                this.setPendingViewState(this.getDefaultViewState());
                this.loadDirectory(fileInfo.path);
            } else {
                this.handleFileInteraction(building);
            }
        });
    }

    initMedia() {
        this.audioElement = new Audio();
        this.audioElement.loop = false;
        this.audioElement.volume = 0.85;

        this.videoElement = document.createElement('video');
        this.videoElement.autoplay = true;
        this.videoElement.loop = true;
        this.videoElement.muted = false;
        this.videoElement.crossOrigin = 'anonymous';
        this.videoElement.style.display = 'none';
        document.body.appendChild(this.videoElement);

        this.videoCanvas = document.createElement('canvas');
        this.videoCanvas.width = 512;
        this.videoCanvas.height = 512;
        this.videoCanvasCtx = this.videoCanvas.getContext('2d');
        this.videoCanvasTexture = new THREE.CanvasTexture(this.videoCanvas);
        this.videoCanvasTexture.encoding = THREE.sRGBEncoding;
        this.videoCanvasTexture.needsUpdate = false;
        this.videoCanvasTexture.magFilter = THREE.LinearFilter;
        this.videoCanvasTexture.minFilter = THREE.LinearFilter;
        this.videoCanvasTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.videoCanvasTexture.wrapT = THREE.ClampToEdgeWrapping;
    }

    requestPointerLock() {
        document.body.requestPointerLock();
    }

    createScene() {
        const ambientLight = new THREE.AmbientLight(0x001122, 0.3);
        this.scene.add(ambientLight);

        this.createNeonGrid();
        this.createParticleSystem();
    }

    createNeonGrid() {
        const planeSize = this.gridSpacing * 64;
        const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
        const material = new THREE.MeshBasicMaterial({
            color: 0x001020,
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = -0.05;
        plane.renderOrder = -20;
        this.scene.add(plane);
        this.basePlane = plane;
    }

    createParticleSystem() {
        const particleCount = 500;
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * 400;
            positions[i3 + 1] = Math.random() * 200;
            positions[i3 + 2] = (Math.random() - 0.5) * 400;

            const color = new THREE.Color();
            color.setHSL(Math.random() * 0.3 + 0.5, 1, 0.5);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;
        }

        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMaterial = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });

        const particleSystem = new THREE.Points(particles, particleMaterial);
        this.scene.add(particleSystem);
    }

    ensurePavementAssets() {
        if (!this.pavementTexture) {
            this.pavementTexture = this.createPavementTexture();
            if (this.pavementTexture) {
                this.pavementTexture.wrapS = THREE.ClampToEdgeWrapping;
                this.pavementTexture.wrapT = THREE.ClampToEdgeWrapping;
                this.pavementTexture.magFilter = THREE.LinearFilter;
                this.pavementTexture.minFilter = THREE.LinearMipMapLinearFilter;
                this.pavementTexture.encoding = THREE.sRGBEncoding;
                if (this.renderer && this.renderer.capabilities && typeof this.renderer.capabilities.getMaxAnisotropy === 'function') {
                    this.pavementTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
                }
                this.pavementTexture.needsUpdate = true;
            }
        }
        if (!this.pavementMaterial && this.pavementTexture) {
            this.pavementMaterial = new THREE.MeshBasicMaterial({
                map: this.pavementTexture,
                transparent: true,
                opacity: 1,
                toneMapped: false,
                depthWrite: false
            });
        }
        if (!this.pavementGeometry) {
            this.pavementGeometry = new THREE.PlaneGeometry(this.gridSpacing, this.gridSpacing);
        }
    }

    createPavementTexture() {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        ctx.clearRect(0, 0, size, size);

        const glowColor = 'rgba(0, 255, 255,';
        const walkwayRatio = 0.64;
        const streetMargin = (1 - walkwayRatio) / 2;
        const streetWidth = streetMargin * size;
        const lineThickness = streetWidth * 0.5;
        const lineHalf = lineThickness / 2;
        const centerOffset = streetWidth / 2;

        ctx.fillStyle = `${glowColor}0.5)`;
        ctx.fillRect(0, centerOffset - lineHalf, size, lineThickness);
        ctx.fillRect(0, size - centerOffset - lineHalf, size, lineThickness);
        ctx.fillRect(centerOffset - lineHalf, 0, lineThickness, size);
        ctx.fillRect(size - centerOffset - lineHalf, 0, lineThickness, size);

        const walkwaySize = walkwayRatio * size;
        const walkwayOffset = (size - walkwaySize) / 2;
        const cornerRadius = walkwaySize * 0.16;

        ctx.fillStyle = `${glowColor}1)`;
        this.drawRoundedRect(ctx, walkwayOffset, walkwayOffset, walkwaySize, walkwaySize, cornerRadius);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    async loadDirectory(path = null) {
        const targetPath = path ?? null;
        try {
            this.cancelRightClickHold();
            this.stopMedia();

            const url = targetPath ? `/api/browse?path=${encodeURIComponent(targetPath)}` : '/api/browse';
            const response = await fetch(url);
            const data = await response.json();

            this.directoryToken += 1;
            this.currentPath = data.path;
            this.allFiles = data.items;

            this.previewCache.forEach((texture) => {
                if (texture && typeof texture.dispose === 'function') {
                    texture.dispose();
                }
            });
            this.previewCache.clear();
            this.pendingPreviewLoads.clear();

            document.getElementById('current-path').textContent = this.currentPath;

            await this.loadFavourites();
            this.applyFileFilter();
            this.applyPendingViewState();
            this.pendingStackPushPath = null;
        } catch (error) {
            console.error('Failed to load directory:', error);
            if (this.pendingStackPushPath && targetPath === this.pendingStackPushPath && this.viewStack.length) {
                this.viewStack.pop();
            }
            this.pendingStackPushPath = null;
            this.pendingViewState = null;
        }
    }

    applyFileFilter() {
        if (!this.allFiles) {
            return;
        }

        this.fileData = this.showHidden ? [...this.allFiles] : this.allFiles.filter(file => !file.name.startsWith('.'));
        document.getElementById('entity-count').textContent = this.fileData.length;

        this.clearBuildings();
        this.createBuildings();
        this.forcePreviewRefresh();
    }

    async loadFavourites() {
        try {
            const response = await fetch('/api/favourites');
            if (!response.ok) {
                throw new Error('favourites fetch failed');
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                this.favourites = new Set(data);
            }
        } catch (error) {
            console.warn('Failed to load favourites:', error);
            this.favourites = new Set();
        }
    }

    clearBuildings() {
        this.buildings.forEach((building) => {
            this.removePreviewCube(building);
            building.traverse(child => {
                if (child.isMesh || child.isLine || child.isSprite) {
                    const userData = child.userData || {};
                    const retainShared = !!userData.retainShared;
                    const retainGeometry = userData.retainSharedGeometry ?? retainShared;
                    const retainMaterial = userData.retainSharedMaterial ?? retainShared;
                    if (child.geometry && !retainGeometry) {
                        child.geometry.dispose();
                    }
                    const disposeMaterial = (material) => {
                        if (!material) return;
                        if (retainMaterial) {
                            return;
                        }
                        if (material.map && !this.previewCache.has(material.map)) {
                            material.map = null;
                        }
                        material.dispose?.();
                    };
                    if (Array.isArray(child.material)) {
                        child.material.forEach(disposeMaterial);
                    } else {
                        disposeMaterial(child.material);
                    }
                }
            });
            this.scene.remove(building);
        });
        this.buildings = [];
    }

    createBuildings() {
        const columns = this.gridColumns;
        const spacing = this.gridSpacing;
        const rows = Math.max(1, Math.ceil(this.fileData.length / columns));
        const halfWidth = (columns - 1) * spacing / 2;
        const halfDepth = (rows - 1) * spacing / 2;

        this.fileData.forEach((file, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = column * spacing - halfWidth;
            const z = row * spacing - halfDepth;

            const building = this.createBuilding(file, x, z);
            if (building) {
                this.scene.add(building);
                this.buildings.push(building);
            }
        });
    }

    computeBuildingDimensions(file) {
        const baseSize = file.is_directory ? 3.0 : 2.4;
        const logSize = file.log_size ?? 1;
        const height = file.is_directory ? 2.6 : Math.max(0.8, Math.min(14, logSize * 2.2));
        return { baseSize, height };
    }

    getEdgeColor(file) {
        if (file.is_directory) {
            return this.colors.directory;
        }
        if (file.mime_type) {
            if (file.mime_type.startsWith('image/')) return this.colors.image;
            if (file.mime_type.startsWith('text/')) return this.colors.text;
            if (file.mime_type.startsWith('audio/')) return this.colors.file;
            if (file.mime_type.startsWith('video/')) return this.colors.file;
        }
        if (file.name.match(/\.(exe|app|sh|bat|cmd)$/i)) {
            return this.colors.executable;
        }
        return this.colors.file;
    }

    createBuilding(file, x, z) {
        const { baseSize, height } = this.computeBuildingDimensions(file);

        const group = new THREE.Group();
        group.position.set(x, 0, z);

        this.ensurePavementAssets();
        let pavement = null;
        if (this.pavementGeometry && this.pavementMaterial) {
            const pavementMaterial = this.pavementMaterial.clone();
            pavement = new THREE.Mesh(this.pavementGeometry, pavementMaterial);
            pavement.rotation.x = -Math.PI / 2;
            pavement.position.y = 0.01;
            pavement.renderOrder = -10;
            pavement.userData = pavement.userData || {};
            pavement.userData.retainSharedGeometry = true;
            pavement.userData.retainSharedMaterial = false;
            group.add(pavement);
        }

        const geometry = new THREE.BoxGeometry(baseSize, height, baseSize);
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, fillMaterial);
        mesh.position.y = height / 2;

        const edgeMaterial = new THREE.LineBasicMaterial({
            color: this.getEdgeColor(file),
            linewidth: 2,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
        edges.position.y = height / 2;

        group.add(mesh);
        group.add(edges);

        group.userData = {
            fileInfo: file,
            mesh,
            edges,
            height,
            baseSize,
            previewCube: null,
            previewMode: null,
            previewAssets: {},
            currentMedia: null,
            directoryToken: this.directoryToken,
            labels: [],
            inFocus: false,
            pavement,
            pavementBaseColor: pavement && pavement.material ? pavement.material.color.clone() : null,
            mediaActive: false,
            mediaPaused: false,
            pavementHighlightColor: null,
            pavementHighlightHSL: null,
            pavementPausedColor: pavement ? new THREE.Color(this.colors.mediaPaused) : null
        };

        if (file.is_favourite) {
            this.favourites.add(file.path);
        }

        this.applyFavouriteStyling(group, this.favourites.has(file.path));
        this.addBuildingLabel(group, file.name, height, !file.is_directory);
        return group;
    }

    forcePreviewRefresh() {
        this.lastPreviewUpdate = 0;
        this.updateBuildingPreviews(true);
    }

    updateBuildingPreviews(force = false) {
        if (!this.buildings.length) {
            return;
        }

        const now = performance.now();
        if (!force && now - this.lastPreviewUpdate < this.previewUpdateInterval) {
            return;
        }
        this.lastPreviewUpdate = now;

        const cameraPosition = new THREE.Vector3();
        this.camera.getWorldPosition(cameraPosition);
        const tempPosition = new THREE.Vector3();

        const sorted = [...this.buildings].sort((a, b) => {
            a.getWorldPosition(tempPosition);
            const distA = cameraPosition.distanceToSquared(tempPosition);
            b.getWorldPosition(tempPosition);
            const distB = cameraPosition.distanceToSquared(tempPosition);
            return distA - distB;
        });

        const focusSet = new Set(sorted.slice(0, Math.min(this.detailCount, sorted.length)));

        this.buildings.forEach((building) => {
            const data = building.userData;
            data.inFocus = focusSet.has(building);
            if (data.inFocus) {
                this.ensurePreviewForBuilding(building);
            } else if (data.currentMedia !== 'video') {
                this.removePreviewCube(building);
            }
        });
    }

    updateMediaHighlights() {
        if (!this.buildings.length) {
            return;
        }

        const time = performance.now() * 0.006;
        const pulse = (Math.sin(time) + 1) / 2;

        this.buildings.forEach((building) => {
            const data = building.userData;
            if (!data || !data.mediaActive) {
                return;
            }
            const pavement = data.pavement;
            const material = pavement && pavement.material;
            if (!material) {
                return;
            }

            if (data.mediaPaused) {
                if (!data.pavementPausedColor) {
                    data.pavementPausedColor = new THREE.Color(this.colors.mediaPaused);
                }
                material.color.copy(data.pavementPausedColor);
                material.needsUpdate = true;
                return;
            }

            if (!data.pavementHighlightColor) {
                data.pavementHighlightColor = new THREE.Color(this.colors.favourite);
            }
            if (!data.pavementHighlightHSL) {
                const hsl = { h: 0, s: 0, l: 0 };
                data.pavementHighlightColor.getHSL(hsl);
                data.pavementHighlightHSL = hsl;
            }

            const highlightHSL = data.pavementHighlightHSL;
            const lightness = THREE.MathUtils.clamp(0.4 + pulse * 0.5, 0, 1);
            material.color.setHSL(highlightHSL.h, highlightHSL.s, lightness);
            material.needsUpdate = true;
        });
    }

    ensurePreviewForBuilding(building) {
        const data = building.userData;
        if (!data.inFocus) {
            return;
        }

        if (data.currentMedia === 'video' && this.mediaBuilding === building && this.videoCanvasTexture) {
            this.updatePreviewCube(building, this.videoCanvasTexture);
            return;
        }

        const file = data.fileInfo;
        const mode = this.getDefaultPreviewMode(file);
        data.previewMode = mode;
        const assets = data.previewAssets;
        const key = `${file.path}|${mode}`;

        if (assets[mode]) {
            this.updatePreviewCube(building, assets[mode]);
            return;
        }
        if (this.previewCache.has(key)) {
            const texture = this.previewCache.get(key);
            assets[mode] = texture;
            this.updatePreviewCube(building, texture);
            return;
        }

        this.requestPreviewTexture(building, mode);
    }

    getDefaultPreviewMode(file) {
        if (file.is_directory) {
            return 'directory';
        }
        const ext = this.getFileExtension(file.name);
        if (this.isImagePreviewExtension(ext)) {
            return 'image';
        }
        return 'hex';
    }

    requestPreviewTexture(building, mode) {
        const file = building.userData.fileInfo;
        const path = file.path;
        const key = `${path}|${mode}`;

        if (mode === 'directory') {
            const texture = this.getDirectoryPreviewTexture();
            building.userData.previewAssets[mode] = texture;
            this.previewCache.set(key, texture);
            if (building.userData.inFocus) {
                this.updatePreviewCube(building, texture);
            }
            return;
        }

        if (this.pendingPreviewLoads.has(key)) {
            return;
        }
        this.pendingPreviewLoads.add(key);

        if (mode === 'image') {
            const imageUrl = this.getFilePreviewUrl(path);
            if (!imageUrl) {
                this.pendingPreviewLoads.delete(key);
                return;
            }
            fetch(imageUrl)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error('image preview failed');
                    }
                    return response.blob();
                })
                .then((blob) => window.createImageBitmap ? window.createImageBitmap(blob) : this.loadImageViaElement(blob))
                .then((bitmap) => {
                    this.pendingPreviewLoads.delete(key);
                    if (!bitmap || !this.isBuildingCurrent(building)) {
                        return;
                    }
                    const texture = this.createImagePreviewTexture(bitmap);
                    if (texture) {
                        this.previewCache.set(key, texture);
                        building.userData.previewAssets[mode] = texture;
                        if (building.userData.previewMode === mode && building.userData.inFocus) {
                            this.updatePreviewCube(building, texture);
                        }
                    }
                })
                .catch(() => {
                    this.pendingPreviewLoads.delete(key);
                });
            return;
        }

        fetch(`/api/file-hex?path=${encodeURIComponent(path)}&max_bytes=512`)
            .then((response) => {
                if (!response.ok) {
                    throw new Error('hex preview failed');
                }
                return response.json();
            })
            .then((data) => {
                this.pendingPreviewLoads.delete(key);
                if (!data || !Array.isArray(data.lines) || !this.isBuildingCurrent(building)) {
                    return;
                }
                const texture = this.createHexPreviewTexture(data.lines);
                if (texture) {
                    this.previewCache.set(key, texture);
                    building.userData.previewAssets[mode] = texture;
                    if (building.userData.previewMode === mode && building.userData.inFocus) {
                        this.updatePreviewCube(building, texture);
                    }
                }
            })
            .catch(() => {
                this.pendingPreviewLoads.delete(key);
            });
    }

    loadImageViaElement(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    isBuildingCurrent(building) {
        return this.buildings.includes(building) && building.userData.directoryToken === this.directoryToken;
    }

    createHexPreviewTexture(lines) {
        if (!lines || !lines.length) {
            return null;
        }

        const fontSpec = '14px "Courier New", monospace';
        const lineHeight = 22;
        const topPadding = 24;
        const bottomPadding = 24;
        const leftPadding = 20;
        const rightPadding = 24;
        const maxLines = Math.min(lines.length, 18);

        const offsetWidth = 10; // length of "00000000:" plus trailing space padding
        const hexColumnWidth = 47; // mirrors backend spacing for hex dump
        const formatted = [];

        lines.slice(0, maxLines).forEach((line) => {
            const offsetText = `${line.offset}:`.padEnd(offsetWidth, ' ');
            const hexText = (line.hex || '').trimEnd().padEnd(hexColumnWidth, ' ');
            const asciiText = line.ascii || '';
            formatted.push(`${offsetText}${hexText} ${asciiText}`);
        });

        if (!formatted.length) {
            return null;
        }

        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        if (!measureCtx) {
            return null;
        }
        measureCtx.font = fontSpec;
        let maxTextWidth = 0;
        formatted.forEach((text) => {
            const metrics = measureCtx.measureText(text);
            maxTextWidth = Math.max(maxTextWidth, metrics.width);
        });

        const canvasWidth = Math.max(256, Math.ceil(leftPadding + maxTextWidth + rightPadding));
        const canvasHeight = Math.max(160, Math.ceil(topPadding + bottomPadding + formatted.length * lineHeight));

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2);

        ctx.font = fontSpec;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#00f5ff';

        formatted.forEach((text, index) => {
            const y = topPadding + index * lineHeight;
            ctx.fillText(text, leftPadding, y);
        });

        return this.canvasToTexture(canvas);
    }

    createImagePreviewTexture(bitmap) {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        this.drawSourceToCanvas(bitmap, canvas, ctx, {
            background: 'rgba(0, 0, 0, 0.92)',
            padding: 8,
            stroke: 'rgba(0, 255, 255, 0.35)',
            strokeWidth: 3,
            mode: 'contain'
        });

        return this.canvasToTexture(canvas);
    }

    getDirectoryPreviewTexture() {
        if (this.directoryPreviewTexture) {
            return this.directoryPreviewTexture;
        }
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        ctx.fillStyle = 'rgba(0, 20, 26, 0.7)';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.45)';
        ctx.lineWidth = 4;
        ctx.strokeRect(16, 16, size - 32, size - 32);
        ctx.font = 'bold 64px Orbitron';
        ctx.fillStyle = 'rgba(0, 255, 255, 0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DIR', size / 2, size / 2);

        this.directoryPreviewTexture = this.canvasToTexture(canvas);
        return this.directoryPreviewTexture;
    }

    canvasToTexture(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    updatePreviewCube(building, texture) {
        if (!texture) {
            this.removePreviewCube(building);
            return;
        }

        const data = building.userData;
        const cubeSize = Math.max(0.5, Math.min(this.previewCubeMaxSize, data.height));
        const verticalGap = 0.2;
        const topY = data.height + cubeSize / 2 + verticalGap;

        let cube = data.previewCube;
        if (!cube) {
            const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
            const cubeMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 1,
                toneMapped: false
            });
            cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
            cube.position.set(0, topY, 0);
            cube.renderOrder = 5;
            building.add(cube);
            data.previewCube = cube;
        } else {
            if (cube.geometry) {
                cube.geometry.dispose();
            }
            cube.geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
            cube.position.set(0, topY, 0);
            const applyMaterial = (material) => {
                if (!material) {
                    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1, toneMapped: false });
                }
                material.map = texture;
                material.opacity = 1;
                material.transparent = true;
                material.toneMapped = false;
                material.needsUpdate = true;
                return material;
            };
            if (Array.isArray(cube.material)) {
                cube.material = cube.material.map(applyMaterial);
            } else {
                cube.material = applyMaterial(cube.material);
            }
        }

        texture.needsUpdate = true;
        const cubeTop = data.height + cubeSize + verticalGap;
        this.positionLabelsForPreview(building, true, cubeTop);
    }

    removePreviewCube(building) {
        const data = building.userData;
        const cube = data.previewCube;
        if (!cube) {
            this.positionLabelsForPreview(building, false);
            return;
        }
        this.disposePreviewCube(building, cube);
        data.previewCube = null;
        this.positionLabelsForPreview(building, false);
    }

    disposePreviewCube(building, cube) {
        building.remove(cube);
        if (cube.geometry) {
            cube.geometry.dispose();
        }
        const disposeMaterial = (material) => {
            if (!material) {
                return;
            }
            material.map = null;
            material.dispose?.();
        };
        if (Array.isArray(cube.material)) {
            cube.material.forEach(disposeMaterial);
        } else {
            disposeMaterial(cube.material);
        }
    }

    positionLabelsForPreview(building, hasPreview, previewTop = 0) {
        const data = building?.userData;
        if (!data || !Array.isArray(data.labels) || !data.labels.length) {
            return;
        }

        const height = data.height ?? 0;
        data.labels.forEach((sprite) => {
            if (!sprite) {
                return;
            }
            const info = sprite.userData || {};
            const baseOffset = info.baseOffset ?? (info.isFileLabel ? 0.8 : 1.2);
            if (hasPreview) {
                const extraClearance = info.isFileLabel ? 0.6 : 0.8;
                sprite.position.y = previewTop + extraClearance;
            } else {
                sprite.position.y = height + baseOffset;
            }
        });
    }

    focusPreviewUnderCrosshair(preselectedBuilding = null) {
        const building = preselectedBuilding || this.getBuildingUnderCrosshair();
        if (!building || !building.userData || !building.userData.previewCube) {
            return;
        }
        if (!this.isBuildingCurrent(building)) {
            return;
        }
        this.focusCameraOnPreview(building);
    }

    focusCameraOnPreview(building) {
        const data = building?.userData;
        if (!data || !data.previewCube) {
            return;
        }

        const cube = data.previewCube;
        const cubeWorldPos = new THREE.Vector3();
        cube.getWorldPosition(cubeWorldPos);

        const directionToCamera = new THREE.Vector3().subVectors(this.camera.position, cubeWorldPos);
        if (directionToCamera.lengthSq() < 1e-6) {
            directionToCamera.set(0, 0, 1);
        } else {
            directionToCamera.normalize();
        }

        const absX = Math.abs(directionToCamera.x);
        const absY = Math.abs(directionToCamera.y);
        const absZ = Math.abs(directionToCamera.z);
        const offsetDirection = new THREE.Vector3();

        if (absX >= absY && absX >= absZ) {
            offsetDirection.set(Math.sign(directionToCamera.x) || 1, 0, 0);
        } else if (absY >= absX && absY >= absZ) {
            offsetDirection.set(0, Math.sign(directionToCamera.y) || 1, 0);
        } else {
            offsetDirection.set(0, 0, Math.sign(directionToCamera.z) || 1);
        }

        const cubeSize = Math.max(0.5, Math.min(this.previewCubeMaxSize, data.height || this.previewCubeMaxSize));
        const halfSize = cubeSize / 2;
        const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
        const verticalDistance = halfSize / Math.tan(verticalFov / 2);
        const horizontalDistance = halfSize / Math.tan(horizontalFov / 2);
    const paddingFactor = 1.22;
        const distance = Math.max(verticalDistance, horizontalDistance) * paddingFactor;

        const targetPosition = cubeWorldPos.clone().add(offsetDirection.multiplyScalar(distance));
        if (offsetDirection.y < 0 && targetPosition.y < 1) {
            targetPosition.y = 1;
        }

        this.camera.position.copy(targetPosition);

        const upVector = this.camera.up.clone();
        const lookMatrix = new THREE.Matrix4().lookAt(targetPosition, cubeWorldPos, upVector);
        const lookEuler = new THREE.Euler().setFromRotationMatrix(lookMatrix, 'YXZ');

        this.pitch = THREE.MathUtils.clamp(lookEuler.x, -Math.PI / 2, Math.PI / 2);
        this.yaw = lookEuler.y;
        this.roll = 0;

        const baseEuler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(baseEuler);
    }

    startRightClickHold(building) {
        this.cancelRightClickHold();
        if (!building || !building.userData || !building.userData.fileInfo) {
            return;
        }
        const fileInfo = building.userData.fileInfo;
        if (fileInfo.is_directory || !fileInfo.path) {
            return;
        }
        this.rightClickHoldTarget = building;
        this.rightClickHoldTimer = window.setTimeout(() => {
            if (!this.rightClickHoldTarget || !this.isBuildingCurrent(this.rightClickHoldTarget)) {
                this.cancelRightClickHold();
                return;
            }
            this.openBuildingInNewTab(this.rightClickHoldTarget);
            this.cancelRightClickHold();
        }, this.rightClickHoldDelay);
    }

    cancelRightClickHold() {
        if (this.rightClickHoldTimer) {
            clearTimeout(this.rightClickHoldTimer);
            this.rightClickHoldTimer = null;
        }
        this.rightClickHoldTarget = null;
    }

    openBuildingInNewTab(building) {
        const fileInfo = building?.userData?.fileInfo;
        if (!fileInfo || fileInfo.is_directory || !fileInfo.path) {
            return;
        }
        const url = this.getFilePreviewUrl(fileInfo.path);
        if (!url) {
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    getCurrentViewState() {
        if (!this.camera) {
            return this.getDefaultViewState();
        }
        return {
            position: this.camera.position.clone(),
            pitch: this.pitch,
            yaw: this.yaw,
            roll: this.roll
        };
    }

    cloneViewState(state) {
        if (!state) {
            return null;
        }
        return {
            position: state.position ? state.position.clone() : new THREE.Vector3(0, 10, 20),
            pitch: state.pitch ?? 0,
            yaw: state.yaw ?? 0,
            roll: state.roll ?? 0
        };
    }

    getDefaultViewState() {
        if (this.defaultViewState) {
            return this.cloneViewState(this.defaultViewState);
        }
        return {
            position: new THREE.Vector3(0, 10, 20),
            pitch: 0,
            yaw: 0,
            roll: 0
        };
    }

    pushCurrentViewState() {
        this.viewStack.push(this.getCurrentViewState());
    }

    setPendingViewState(state) {
        this.pendingViewState = state ? this.cloneViewState(state) : null;
    }

    applyViewState(state) {
        if (!state || !this.camera) {
            return;
        }

        this.camera.position.copy(state.position);
        this.pitch = state.pitch ?? 0;
        this.yaw = state.yaw ?? 0;
        this.roll = state.roll ?? 0;
        this.camera_velocity.set(0, 0, 0);

        const baseEuler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(baseEuler);

        if (Math.abs(this.roll) > 1e-6) {
            const rollQuaternion = new THREE.Quaternion();
            rollQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), this.roll);
            this.camera.quaternion.multiply(rollQuaternion);
        }
    }

    applyPendingViewState() {
        if (!this.pendingViewState) {
            return;
        }
        this.applyViewState(this.pendingViewState);
        this.pendingViewState = null;
    }

    drawSourceToCanvas(source, canvas, ctx, options = {}) {
        const {
            background = 'rgba(0, 0, 0, 1)',
            padding = 0,
            stroke = null,
            strokeWidth = 2,
            mode = 'contain'
        } = options;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        const dims = this.getSourceDimensions(source);
        if (dims) {
            const { width, height } = dims;
            const innerWidth = Math.max(1, canvas.width - padding * 2);
            const innerHeight = Math.max(1, canvas.height - padding * 2);
            const scale = mode === 'cover'
                ? Math.max(innerWidth / width, innerHeight / height)
                : Math.min(innerWidth / width, innerHeight / height);
            const drawWidth = width * scale;
            const drawHeight = height * scale;
            const dx = (canvas.width - drawWidth) / 2;
            const dy = (canvas.height - drawHeight) / 2;
            try {
                ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
            } catch (error) {
                console.warn('Failed to draw source to canvas', error);
            }
        }

        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.strokeRect(strokeWidth / 2, strokeWidth / 2, canvas.width - strokeWidth, canvas.height - strokeWidth);
        }

        ctx.restore();
    }

    getSourceDimensions(source) {
        if (!source) {
            return null;
        }
        const width = source.videoWidth || source.naturalWidth || source.width || (source.image && source.image.width) || (source.data && source.data.width) || 0;
        const height = source.videoHeight || source.naturalHeight || source.height || (source.image && source.image.height) || (source.data && source.data.height) || 0;
        if (width > 0 && height > 0) {
            return { width, height };
        }
        return null;
    }

    handleFileInteraction(building) {
        const file = building.userData.fileInfo;
        const ext = this.getFileExtension(file.name);

        if (this.isAudioFileExtension(ext)) {
            this.playAudio(building);
            return;
        }
        if (this.isVideoFileExtension(ext)) {
            this.playVideo(building);
            return;
        }

        this.stopMedia();
    }

    playAudio(building) {
        const file = building.userData.fileInfo;
        const src = this.getFilePreviewUrl(file.path);
        this.stopMedia();

        if (!this.audioElement || !src) {
            return;
        }
        this.audioElement.src = src;
        this.audioElement.play().catch(() => {});
        this.activeMedia = 'audio';
        this.mediaBuilding = building;
    this.setBuildingMediaState(building, true, false);
    }

    playVideo(building) {
        const file = building.userData.fileInfo;
        const src = this.getFilePreviewUrl(file.path);
        this.stopMedia();

        if (!this.videoElement || !this.videoCanvasTexture || !src) {
            return;
        }

        const applyVideoTexture = () => {
            if (!this.isBuildingCurrent(building)) {
                return;
            }
            building.userData.currentMedia = 'video';
            building.userData.previewMode = 'video';
            this.mediaBuilding = building;
            this.activeMedia = 'video';
            this.setBuildingMediaState(building, true, false);
            this.ensurePreviewForBuilding(building);
            this.updateVideoFrame(true);
        };

        const handleLoaded = () => {
            this.videoElement.removeEventListener('loadeddata', handleLoaded);
            this.videoElement.removeEventListener('error', handleError);
            this.pendingVideoHandlers = null;
            applyVideoTexture();
        };

        const handleError = () => {
            this.videoElement.removeEventListener('loadeddata', handleLoaded);
            this.videoElement.removeEventListener('error', handleError);
            this.pendingVideoHandlers = null;
            building.userData.currentMedia = null;
            building.userData.previewMode = null;
            this.setBuildingMediaState(building, false);
            this.ensurePreviewForBuilding(building);
        };

        this.pendingVideoHandlers = { loaded: handleLoaded, error: handleError };
        this.videoElement.addEventListener('loadeddata', handleLoaded);
        this.videoElement.addEventListener('error', handleError);

        this.videoElement.src = src;
        this.videoElement.currentTime = 0;
        this.videoElement.play().catch(() => {});
    }

    updateVideoFrame(force = false) {
        if (this.activeMedia !== 'video' || !this.mediaBuilding || !this.videoElement) {
            return;
        }

        const hasFrame = this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.videoElement.videoWidth > 0;
        if (!hasFrame && !force) {
            return;
        }

        this.drawSourceToCanvas(this.videoElement, this.videoCanvas, this.videoCanvasCtx, {
            background: 'rgba(0, 0, 0, 0.92)',
            padding: 8,
            stroke: 'rgba(255, 0, 128, 0.4)',
            strokeWidth: 3,
            mode: 'contain'
        });
        this.videoCanvasTexture.needsUpdate = true;
        this.updatePreviewCube(this.mediaBuilding, this.videoCanvasTexture);
    }

    stopMedia() {
        const activeBuilding = this.mediaBuilding;
        if (this.activeMedia === 'audio' && this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
        }
        if (this.activeMedia === 'video' && this.videoElement) {
            if (this.pendingVideoHandlers) {
                this.videoElement.removeEventListener('loadeddata', this.pendingVideoHandlers.loaded);
                this.videoElement.removeEventListener('error', this.pendingVideoHandlers.error);
                this.pendingVideoHandlers = null;
            }
            this.videoElement.pause();
            this.videoElement.src = '';
        }

        if (activeBuilding && activeBuilding.userData) {
            activeBuilding.userData.currentMedia = null;
            activeBuilding.userData.previewMode = null;
            if (activeBuilding.userData.inFocus) {
                this.ensurePreviewForBuilding(activeBuilding);
            } else {
                this.removePreviewCube(activeBuilding);
            }
        }

        if (activeBuilding) {
            this.setBuildingMediaState(activeBuilding, false);
        }

        this.activeMedia = null;
        this.mediaBuilding = null;
    }

    setBuildingMediaState(building, isActive, isPaused = false) {
        if (!building || !building.userData) {
            return;
        }
        const data = building.userData;
        data.mediaActive = !!isActive;
        data.mediaPaused = !!(isActive && isPaused);

        const pavement = data.pavement;
        const material = pavement && pavement.material;
        if (!pavement || !material) {
            return;
        }

        if (!data.pavementBaseColor) {
            data.pavementBaseColor = material.color.clone();
        }

        if (!isActive) {
            if (data.pavementBaseColor) {
                material.color.copy(data.pavementBaseColor);
            }
            material.needsUpdate = true;
            return;
        }

        if (!data.pavementHighlightColor) {
            data.pavementHighlightColor = new THREE.Color(this.colors.favourite);
        }
        if (!data.pavementHighlightHSL) {
            const hsl = { h: 0, s: 0, l: 0 };
            data.pavementHighlightColor.getHSL(hsl);
            data.pavementHighlightHSL = hsl;
        }
        if (!data.pavementPausedColor) {
            data.pavementPausedColor = new THREE.Color(this.colors.mediaPaused);
        }

        if (data.mediaPaused && data.pavementPausedColor) {
            material.color.copy(data.pavementPausedColor);
            material.needsUpdate = true;
            return;
        }

        material.needsUpdate = true;
        if (data.pavementHighlightHSL) {
            const hsl = data.pavementHighlightHSL;
            material.color.setHSL(hsl.h, hsl.s, 0.7);
        }
    }

    skipActiveMedia(offsetSeconds) {
        if (!this.activeMedia || !offsetSeconds) {
            return;
        }

        const clampAndApply = (element) => {
            if (!element || typeof element.currentTime !== 'number') {
                return;
            }
            const duration = element.duration;
            const hasDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
            let target = element.currentTime + offsetSeconds;
            if (target < 0) {
                target = 0;
            } else if (hasDuration && target > duration) {
                target = duration;
            }
            element.currentTime = target;
        };

        if (this.activeMedia === 'audio') {
            clampAndApply(this.audioElement);
            return;
        }
        if (this.activeMedia === 'video') {
            clampAndApply(this.videoElement);
        }
    }

    toggleMediaPlayback() {
        if (!this.activeMedia) {
            return;
        }

        const building = this.mediaBuilding;

        if (this.activeMedia === 'audio' && this.audioElement) {
            if (this.audioElement.paused) {
                this.audioElement.play().catch(() => {});
                if (building) {
                    this.setBuildingMediaState(building, true, false);
                }
            } else {
                this.audioElement.pause();
                if (building) {
                    this.setBuildingMediaState(building, true, true);
                }
            }
            return;
        }

        if (this.activeMedia === 'video' && this.videoElement) {
            if (this.videoElement.paused) {
                this.videoElement.play().catch(() => {});
                if (building) {
                    this.setBuildingMediaState(building, true, false);
                }
            } else {
                this.videoElement.pause();
                if (building) {
                    this.setBuildingMediaState(building, true, true);
                }
                this.updateVideoFrame(true);
            }
        }
    }

    getFileExtension(filename) {
        const idx = filename.lastIndexOf('.');
        if (idx === -1) {
            return '';
        }
        return filename.substring(idx + 1).toLowerCase();
    }

    isAudioFileExtension(extension) {
        if (!extension) {
            return false;
        }
        return this.audioExtensions.has(extension);
    }

    isVideoFileExtension(extension) {
        if (!extension) {
            return false;
        }
        return this.videoExtensions.has(extension);
    }

    isImagePreviewExtension(extension) {
        if (!extension) {
            return false;
        }
        return this.imagePreviewExtensions.has(extension);
    }

    getFilePreviewUrl(path, extraParams = {}, options = {}) {
        if (!path) {
            return null;
        }
        const params = new URLSearchParams();
        params.set('path', path);
        Object.entries(extraParams || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                params.set(key, value);
            }
        });
        if (options.cacheBust !== false) {
            params.set('t', Date.now().toString());
        }
        return `/api/file-preview?${params.toString()}`;
    }

    addBuildingLabel(building, text, height, isFile = false) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.font = isFile ? '14px Orbitron' : '16px Orbitron';
        ctx.fillStyle = isFile ? '#00ff9d' : '#00ffff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 4;
        ctx.textAlign = 'center';
        ctx.fillText(text.substring(0, 20), canvas.width / 2, canvas.height / 2 + 6);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(spriteMaterial);

        sprite.position.y = height + (isFile ? 0.8 : 1.2);
        sprite.scale.set(isFile ? 3.2 : 4, 1, 1);
        building.add(sprite);

        sprite.userData = sprite.userData || {};
        sprite.userData.isFileLabel = isFile;
        sprite.userData.baseOffset = sprite.position.y - height;
        if (!building.userData.labels) {
            building.userData.labels = [];
        }
        building.userData.labels.push(sprite);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.updateCamera();
        this.updateParticles();
        this.updateBuildingPreviews();
        this.updateMediaHighlights();
        this.updateVideoFrame();

        this.renderer.render(this.scene, this.camera);
    }

    updateCamera() {
        const baseSpeed = 0.125;
        const baseRotationSpeed = 0.005;
        const isSlow = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
        const speedMultiplier = isSlow ? 0.4 : 1;
        const speed = baseSpeed * speedMultiplier;
        const rotationSpeed = baseRotationSpeed * speedMultiplier;

        this.camera_velocity.set(0, 0, 0);

        if (this.keys['KeyW']) this.camera_velocity.z += speed;
        if (this.keys['KeyS']) this.camera_velocity.z -= speed;
        if (this.keys['KeyA']) this.camera_velocity.x -= speed;
        if (this.keys['KeyD']) this.camera_velocity.x += speed;
        if (this.keys['Space']) this.camera_velocity.y += speed;
        if (this.keys['ControlLeft'] || this.keys['ControlRight']) this.camera_velocity.y -= speed;

        if (this.keys['KeyQ']) this.roll -= rotationSpeed;
        if (this.keys['KeyE']) this.roll += rotationSpeed;

        if (this.roll > Math.PI) this.roll -= Math.PI * 2;
        if (this.roll < -Math.PI) this.roll += Math.PI * 2;

        const baseEuler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
        this.camera.quaternion.setFromEuler(baseEuler);

        if (Math.abs(this.roll) > 1e-6) {
            const rollQuaternion = new THREE.Quaternion();
            rollQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), this.roll);
            this.camera.quaternion.multiply(rollQuaternion);
        }

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

        const movement = new THREE.Vector3();
        movement.addScaledVector(forward, this.camera_velocity.z);
        movement.addScaledVector(right, this.camera_velocity.x);
        movement.addScaledVector(up, this.camera_velocity.y);

        this.camera.position.add(movement);
        this.updateDisplayedCoordinates();
    }

    updateDisplayedCoordinates() {
        if (!this.camera) {
            return;
        }
        const element = document.getElementById('coordinates');
        if (!element) {
            return;
        }
        element.textContent = `${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)}`;
    }

    updateParticles() {
        const time = Date.now() * 0.0005;
        this.scene.traverse((child) => {
            if (child.isPoints) {
                child.rotation.y = time;
            }
        });
    }

    updateLoadingProgress(percent, status) {
        document.getElementById('progress-bar').style.width = `${percent}%`;
        document.getElementById('loading-status').textContent = status;
    }

    getBuildingUnderCrosshair() {
        this.mouse_normalized.x = 0;
        this.mouse_normalized.y = 0;

        this.raycaster.setFromCamera(this.mouse_normalized, this.camera);
        const intersects = this.raycaster.intersectObjects(this.buildings, true);
        if (!intersects.length) {
            return null;
        }

        let node = intersects[0].object;
        while (node && !node.userData.fileInfo) {
            node = node.parent;
        }
        return node || null;
    }

    applyFavouriteStyling(building, isFavourite) {
        const { edges } = building.userData;
        if (!edges || !edges.material) {
            return;
        }
        const edgeMaterial = edges.material;
        edgeMaterial.color.setHex(isFavourite ? this.colors.favourite : this.getEdgeColor(building.userData.fileInfo));
        edgeMaterial.needsUpdate = true;
        building.userData.isFavourite = isFavourite;
    }

    async toggleFavourite(building) {
        if (!building || !building.userData || !building.userData.fileInfo) {
            return;
        }
        const path = building.userData.fileInfo.path;
        const shouldFavourite = !this.favourites.has(path);

        try {
            const response = await fetch('/api/favourites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, favourite: shouldFavourite })
            });
            if (!response.ok) {
                throw new Error('favourite toggle failed');
            }
            const data = await response.json().catch(() => null);
            if (Array.isArray(data)) {
                this.favourites = new Set(data);
            } else if (shouldFavourite) {
                this.favourites.add(path);
            } else {
                this.favourites.delete(path);
            }
            const isFavourite = this.favourites.has(path);
            building.userData.fileInfo.is_favourite = isFavourite;
            this.applyFavouriteStyling(building, isFavourite);
        } catch (error) {
            console.warn('Failed to toggle favourite:', error);
        }
    }

    toggleHidden() {
        if (this.activeMedia) {
            this.stopMedia();
        }
        this.showHidden = !this.showHidden;
        this.applyFileFilter();
    }

    toggleFavouriteUnderCrosshair() {
        const building = this.getBuildingUnderCrosshair();
        if (building) {
            this.toggleFavourite(building);
        }
    }

    reloadCurrentDirectory() {
        this.cancelRightClickHold();
        if (this.currentPath) {
            this.setPendingViewState(this.getCurrentViewState());
            this.pendingStackPushPath = null;
            this.loadDirectory(this.currentPath);
        } else {
            this.setPendingViewState(this.getCurrentViewState());
            this.pendingStackPushPath = null;
            this.loadDirectory();
        }
    }

    cycleRenderDetail() {
        const options = [9, 16, 25];
        const currentIndex = options.indexOf(this.detailCount);
        this.detailCount = options[(currentIndex + 1) % options.length];
        this.forcePreviewRefresh();
    }

    goToParentDirectory() {
        this.cancelRightClickHold();
        if (!this.currentPath) {
            this.viewStack = [];
            this.pendingStackPushPath = null;
            this.setPendingViewState(this.getDefaultViewState());
            this.applyPendingViewState();
            return;
        }

        const parts = this.currentPath.split(/[\\/]/).filter(Boolean);
        if (!parts.length) {
            this.viewStack = [];
            this.pendingStackPushPath = null;
            this.setPendingViewState(this.getDefaultViewState());
            this.applyPendingViewState();
            return;
        }

        parts.pop();
        const parentPath = parts.length ? `/${parts.join('/')}` : null;
        const viewState = this.viewStack.length ? this.viewStack.pop() : null;
        this.setPendingViewState(viewState ?? this.getDefaultViewState());
        this.pendingStackPushPath = null;
        this.loadDirectory(parentPath);
    }

    goToHome() {
        this.cancelRightClickHold();
        this.viewStack = [];
        this.setPendingViewState(this.getDefaultViewState());
        this.pendingStackPushPath = null;
        this.loadDirectory();
    }

    addNavigationEffect(building) {
        const geometry = new THREE.SphereGeometry(2, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.8,
            wireframe: true
        });

        const effect = new THREE.Mesh(geometry, material);
        const worldPos = new THREE.Vector3();
        building.getWorldPosition(worldPos);
        effect.position.copy(worldPos);
        effect.position.y += building.userData.height / 2;
        this.scene.add(effect);

        const startTime = Date.now();
        const duration = 1000;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= duration) {
                this.scene.remove(effect);
                geometry.dispose();
                material.dispose();
                return;
            }
            const progress = elapsed / duration;
            effect.scale.setScalar(1 + progress * 2);
            effect.material.opacity = 0.8 * (1 - progress);
            requestAnimationFrame(animate);
        };
        animate();
    }
}

// Initialize FileCity when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FileCity();
});
