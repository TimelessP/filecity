/**
 * FileCity - 3D Cyberpunk File System Browser
 * Main JavaScript module handling 3D rendering, navigation, and file system visualization
 */

class FileCity {
    constructor() {
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
        
    // Performance settings
    this.detailCount = 9; // 3x3 grid of detailed buildings
    this.renderDistance = 100;
        
    // Raycasting for interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse_normalized = new THREE.Vector2();

    // Texture management
    this.textureCache = new Map();
    this.pendingTextureLoads = new Set();
    this.lastTextureUpdate = 0;
    this.textureUpdateInterval = 400; // ms
    this.ghostTexture = this.createGhostTexture();
    this.directoryTexture = this.createDirectoryTexture();

    this.textureLoader = new THREE.TextureLoader();

    // Media playback state
    this.activeMedia = null; // 'audio' | 'video'
    this.audioElement = null;
    this.videoElement = null;
    this.videoTexture = null;
    this.mediaBuilding = null;
    this.directoryToken = 0;
        
        // Colors and materials
        this.colors = {
            directory: 0x00ffff,    // Cyan for folders
            file: 0x00ff00,         // Green for files
            executable: 0xff0080,   // Magenta for executables
            image: 0xffff00,        // Yellow for images
            text: 0x80ff80,         // Light green for text files
            grid: 0x004040,         // Dark cyan for grid lines
            glow: 0x00ffff,         // Cyan glow
            favourite: 0xff8c00     // Neon orange for favourites
        };
        
        this.init();
    }
    
    async init() {
        this.updateLoadingProgress(10, "Initializing 3D Engine...");
        
        // Initialize Three.js
        this.initThreeJS();
        this.updateLoadingProgress(30, "Setting up cybernet protocols...");
        
        // Setup controls
        this.initControls();
        this.updateLoadingProgress(50, "Loading neural interface...");

        this.initMedia();
        
    // Create initial scene
    this.createScene();
    this.updateLoadingProgress(60, "Syncing favourites cache...");

    await this.loadFavourites();
    this.updateLoadingProgress(70, "Scanning file matrix...");

    // Load initial directory
    await this.loadDirectory();
    this.updateLoadingProgress(90, "Materializing data structures...");
        
        // Start render loop
        this.animate();
        this.updateLoadingProgress(100, "FileCity Matrix Online!");
        
        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('hud').style.display = 'block';
        }, 1000);
    }
    
    initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000008); // Very dark blue-black
        this.scene.fog = new THREE.Fog(0x000008, 30, 200);
        
        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 20);
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }
    
    initControls() {
        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            this.keys[event.code] = true;
        });
        
        document.addEventListener('keyup', (event) => {
            this.keys[event.code] = false;
        });
        
        // Special navigation keys
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
                this.loadDirectory(this.currentPath); // Refresh
            }
            if (event.code === 'KeyP') {
                event.preventDefault();
                this.stopMedia();
            }
            if (event.code === 'KeyC') {
                event.preventDefault();
                this.roll = 0;
            }
            if (event.code === 'KeyF') {
                event.preventDefault();
                const building = this.getBuildingUnderCrosshair();
                if (building) {
                    this.toggleFavourite(building);
                }
            }
            if (event.code === 'Period') {
                event.preventDefault();
                this.showHidden = !this.showHidden;
                this.applyFileFilter();
            }
        });
        
        // Mouse controls (pointer lock)
        document.addEventListener('click', () => {
            if (!this.isPointerLocked) {
                this.requestPointerLock();
            }
        });
        
        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === document.body;
        });
        
        document.addEventListener('mousemove', (event) => {
            if (this.isPointerLocked) {
                const sensitivity = 0.002;
                this.yaw -= event.movementX * sensitivity;
                this.pitch -= event.movementY * sensitivity; // Non-inverted pitch
                const pitchLimit = Math.PI / 2 - 0.001;
                this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch));
            }
        });
        
        // Click to navigate to directories
        document.addEventListener('click', (event) => {
            if (this.isPointerLocked) {
                this.handleClick();
            }
        });
    }

    initMedia() {
        this.audioElement = new Audio();
        this.audioElement.loop = false;
        this.audioElement.volume = 0.8;

        this.videoElement = document.createElement('video');
        this.videoElement.autoplay = true;
        this.videoElement.loop = true;
        this.videoElement.muted = false;
        this.videoElement.crossOrigin = 'anonymous';
        this.videoElement.style.display = 'none';
        document.body.appendChild(this.videoElement);

        this.videoTexture = new THREE.VideoTexture(this.videoElement);
        this.videoTexture.encoding = THREE.sRGBEncoding;
        this.videoTexture.needsUpdate = false;
        this.videoTexture.minFilter = THREE.LinearFilter;
        this.videoTexture.magFilter = THREE.LinearFilter;
        this.videoTexture.generateMipmaps = false;
    }
    
    requestPointerLock() {
        document.body.requestPointerLock();
    }
    
    createScene() {
        // Ambient lighting for cyberpunk atmosphere
        const ambientLight = new THREE.AmbientLight(0x001122, 0.3);
        this.scene.add(ambientLight);
        
        // Neon grid ground
        this.createNeonGrid();
        
        // Add atmospheric particles
        this.createParticleSystem();
    }
    
    createNeonGrid() {
        const gridSize = 200;
        const divisions = 40;
        
        // Main grid
        const grid = new THREE.GridHelper(gridSize, divisions, this.colors.grid, this.colors.grid);
        grid.material.opacity = 0.3;
        grid.material.transparent = true;
        this.scene.add(grid);
        
        // Glowing center lines
        const centerLineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-gridSize/2, 0, 0),
            new THREE.Vector3(gridSize/2, 0, 0)
        ]);
        const centerLineMaterial = new THREE.LineBasicMaterial({ 
            color: this.colors.glow,
            opacity: 0.8,
            transparent: true
        });
        const centerLineX = new THREE.Line(centerLineGeometry, centerLineMaterial);
        this.scene.add(centerLineX);
        
        const centerLineZ = new THREE.Line(centerLineGeometry, centerLineMaterial);
        centerLineZ.rotation.y = Math.PI / 2;
        this.scene.add(centerLineZ);
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
            
            // Random cyber colors
            const color = new THREE.Color();
            color.setHSL(Math.random() * 0.3 + 0.5, 1, 0.5); // Cyan to magenta range
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
    
    async loadDirectory(path = null) {
        try {
            this.stopMedia();

            const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
            const response = await fetch(url);
            const data = await response.json();
            
            this.directoryToken += 1;
            this.currentPath = data.path;
            this.allFiles = data.items;

            this.textureCache.forEach(texture => {
                if (texture && typeof texture.dispose === 'function') {
                    texture.dispose();
                }
            });
            this.textureCache.clear();
            this.pendingTextureLoads.clear();
            
            // Update HUD path and rebuild scene with current filter
            document.getElementById('current-path').textContent = this.currentPath;

            await this.loadFavourites();
            this.applyFileFilter();
            
        } catch (error) {
            console.error('Failed to load directory:', error);
        }
    }
    
    clearBuildings() {
        this.buildings.forEach(building => {
            this.scene.remove(building);
            building.traverse(child => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(material => {
                        if (material.map && material.map !== this.ghostTexture && material.map !== this.directoryTexture && material.map !== this.videoTexture) {
                            material.map.dispose();
                        }
                        material.map = null;
                        material.dispose();
                    });
                }
            });
        });
        this.buildings = [];
    }

    applyFileFilter() {
        if (!this.allFiles) {
            return;
        }

        this.fileData = this.showHidden ? [...this.allFiles] : this.allFiles.filter(file => !file.name.startsWith('.'));
        document.getElementById('entity-count').textContent = this.fileData.length;

        this.clearBuildings();
        this.createBuildings();
        this.forceTextureRefresh();
    }

    async loadFavourites() {
        try {
            const response = await fetch('/api/favourites');
            if (!response.ok) return;
            const data = await response.json();
            if (Array.isArray(data)) {
                this.favourites = new Set(data);
            }
        } catch (error) {
            console.warn('Failed to load favourites:', error);
        }
    }
    
    createBuildings() {
        const gridSize = 8; // 8x8 grid of positions
        const spacing = 8;
        
        this.fileData.forEach((file, index) => {
            const x = (index % gridSize) * spacing - (gridSize * spacing) / 2;
            const z = Math.floor(index / gridSize) * spacing - (gridSize * spacing) / 2;

            const building = this.createBuilding(file, x, z);
            if (building) {
                this.buildings.push(building);
                this.scene.add(building);
            }
        });
    }
    
    createBuilding(file, x, z) {
        const height = file.is_directory ? 2.5 : Math.max(0.5, file.log_size * 3);
        const width = file.is_directory ? 3.5 : 2.4;
        const depth = width;

        if (file.is_favourite) {
            this.favourites.add(file.path);
        }

        const building = new THREE.Group();
        building.position.set(x, 0, z);

        const geometry = new THREE.BoxGeometry(width, height, depth);

        const surfaceMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });

        const topMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1,
            depthWrite: false
        });

        const materials = [
            surfaceMaterial.clone(), // right
            surfaceMaterial.clone(), // left
            topMaterial,             // top
            surfaceMaterial.clone(), // bottom
            surfaceMaterial.clone(), // front
            surfaceMaterial.clone()  // back
        ];

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.position.y = height / 2;

        const rimHeight = Math.min(0.6, Math.max(0.3, height * 0.15));
        const rimGeometry = new THREE.BoxGeometry(width * 0.98, rimHeight, depth * 0.98);
        const rimMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            depthWrite: false
        });
        const rim = new THREE.Mesh(rimGeometry, rimMaterial);
        rim.position.y = height - rimHeight / 2 - 0.02;

        // Edge glow
        let edgeColor = this.colors.file;
        if (file.is_directory) {
            edgeColor = this.colors.directory;
        } else if (file.mime_type) {
            if (file.mime_type.startsWith('image/')) edgeColor = this.colors.image;
            else if (file.mime_type.startsWith('text/')) edgeColor = this.colors.text;
            else if (file.name.match(/\.(exe|app|sh|bat|cmd)$/i)) edgeColor = this.colors.executable;
        }

        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: edgeColor,
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edgeLines.position.y = height / 2;

        building.add(mesh);
        building.add(rim);
        building.add(edgeLines);

        building.userData = {
            fileInfo: file,
            mesh,
            topMaterial,
            rimMaterial,
            height,
            width,
            textureState: file.is_directory ? 'directory' : 'ghost',
            edges: edgeLines,
            edgeMaterial,
            edgeBaseColor: edgeColor,
            directoryToken: this.directoryToken,
            previousMap: null,
            previousRimMap: null,
            previousState: null
        };

        if (file.is_directory) {
            this.applyDirectoryTexture(building);
        } else {
            this.applyGhostTexture(building);
        }

        this.applyFavouriteStyling(building, this.favourites.has(file.path));

        if (file.is_directory) {
            this.addBuildingLabel(building, file.name, height);
        } else {
            this.addBuildingLabel(building, file.name, height, true);
        }

        return building;
    }
    
    applyHexTexture(building, texture) {
        if (!texture) return;
        const { topMaterial, rimMaterial } = building.userData;
        topMaterial.map = texture;
        topMaterial.opacity = 1;
        topMaterial.needsUpdate = true;
        if (rimMaterial) {
            rimMaterial.map = texture;
            rimMaterial.opacity = 1;
            rimMaterial.needsUpdate = true;
        }
        building.userData.textureState = 'loaded';
    }

    applyGhostTexture(building) {
        if (!this.ghostTexture) return;
        const { topMaterial, rimMaterial } = building.userData;
        topMaterial.map = this.ghostTexture;
        topMaterial.opacity = 1;
        topMaterial.needsUpdate = true;
        if (rimMaterial) {
            rimMaterial.map = this.ghostTexture;
            rimMaterial.opacity = 1;
            rimMaterial.needsUpdate = true;
        }
        building.userData.textureState = 'ghost';
    }

    applyDirectoryTexture(building) {
        if (!this.directoryTexture) return;
        const { topMaterial, rimMaterial } = building.userData;
        topMaterial.map = this.directoryTexture;
        topMaterial.opacity = 1;
        topMaterial.needsUpdate = true;
        if (rimMaterial) {
            rimMaterial.map = this.directoryTexture;
            rimMaterial.opacity = 1;
            rimMaterial.needsUpdate = true;
        }
        building.userData.textureState = 'directory';
    }

    createHexTexture(lines) {
        const dimension = 512;
        const canvas = document.createElement('canvas');
        canvas.width = dimension;
        canvas.height = dimension;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Semi-transparent background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.font = '18px "Courier New", monospace';
        ctx.textBaseline = 'top';

        const offsetColumnX = 24;
        const lineHeight = 34;
        const maxLines = Math.floor((canvas.height - 60) / lineHeight);

        ctx.globalCompositeOperation = 'source-over';

        const renderLines = lines.slice(0, maxLines);
        renderLines.forEach((line, index) => {
            const y = 20 + index * lineHeight;
            ctx.fillStyle = '#00f5ff';
            ctx.fillText(`${line.offset}: ${line.hex}`, offsetColumnX, y);
            ctx.fillStyle = '#ff6cff';
            ctx.fillText(line.ascii, offsetColumnX, y + 18);
        });

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        if (this.renderer) {
            texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        }
        texture.needsUpdate = true;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipMapLinearFilter;
        return texture;
    }

    createGhostTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.25)';
        ctx.lineWidth = 1;

        const grid = 8;
        for (let i = 0; i <= grid; i++) {
            const pos = (size / grid) * i;
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, size);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(size, pos);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255, 0, 128, 0.35)';
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2.5, 0, Math.PI * 2);
        ctx.stroke();

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    createDirectoryTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.fillStyle = 'rgba(0, 30, 40, 0.5)';
        ctx.fillRect(0, 0, size, size);

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
        ctx.lineWidth = 3;
        ctx.strokeRect(12, 12, size - 24, size - 24);

        ctx.font = 'bold 48px Orbitron';
        ctx.fillStyle = 'rgba(0, 255, 255, 0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('DIR', size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        return texture;
    }

    updateBuildingTextures(force = false) {
        if (!this.buildings.length) return;

        const now = performance.now();
        if (!force && now - this.lastTextureUpdate < this.textureUpdateInterval) {
            return;
        }
        this.lastTextureUpdate = now;

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

        const detailSet = new Set(sorted.slice(0, Math.min(this.detailCount, sorted.length)));

        this.buildings.forEach(building => {
            if (detailSet.has(building)) {
                this.ensureBuildingHasTexture(building);
            } else if (!building.userData.fileInfo.is_directory) {
                this.ensureBuildingGhost(building);
            } else {
                this.applyDirectoryTexture(building);
            }
        });
    }

    ensureBuildingHasTexture(building) {
        if (building.userData.textureState === 'video') {
            return; // Preserve active video playback texture
        }
        const file = building.userData.fileInfo;
        if (building.userData.directoryToken !== this.directoryToken) {
            return;
        }
        if (file.is_directory) {
            this.applyDirectoryTexture(building);
            return;
        }

        const extension = this.getFileExtension(file.name);
        if (['png', 'jpg', 'jpeg'].includes(extension)) {
            this.ensureImageTexture(building);
            return;
        }

        if (building.userData.textureState === 'loaded') return;

        const path = file.path;
        if (this.textureCache.has(path)) {
            const cachedTexture = this.textureCache.get(path);
            this.applyHexTexture(building, cachedTexture);
            return;
        }

        if (this.pendingTextureLoads.has(path)) {
            return;
        }

        this.pendingTextureLoads.add(path);

        fetch(`/api/file-hex?path=${encodeURIComponent(path)}&max_bytes=512`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch hex for ${path}`);
                }
                return response.json();
            })
            .then(data => {
                this.pendingTextureLoads.delete(path);
                if (!data || !data.lines) {
                    this.ensureBuildingGhost(building);
                    return;
                }

                if (building.userData.directoryToken !== this.directoryToken) {
                    return;
                }

                const texture = this.createHexTexture(data.lines);
                if (!texture) return;

                this.textureCache.set(path, texture);

                // Ensure building still exists and represents the same file
                if (this.buildings.includes(building) && building.userData.fileInfo.path === path && building.userData.directoryToken === this.directoryToken) {
                    this.applyHexTexture(building, texture);
                }
            })
            .catch(() => {
                this.pendingTextureLoads.delete(path);
                this.ensureBuildingGhost(building);
            });
    }

    ensureBuildingGhost(building) {
            if (building.userData.fileInfo.is_directory) {
                this.applyDirectoryTexture(building);
                return;
            }
            if (building.userData.textureState === 'ghost' || building.userData.textureState === 'video') return;
            this.applyGhostTexture(building);
    }

    forceTextureRefresh() {
        this.lastTextureUpdate = 0;
        this.updateBuildingTextures(true);
    }

        ensureImageTexture(building) {
            const file = building.userData.fileInfo;
            const cacheKey = `img:${file.path}`;

            if (building.userData.textureState === 'image' && building.userData.directoryToken === this.directoryToken) {
                return;
            }

            if (building.userData.textureState === 'image-missing' && building.userData.directoryToken === this.directoryToken) {
                return;
            }

            if (this.textureCache.has(cacheKey)) {
                const texture = this.textureCache.get(cacheKey);
                if (!texture) {
                    this.applyGhostTexture(building);
                    building.userData.textureState = 'image-missing';
                    return;
                }
                this.applyImageTexture(building, texture);
                return;
            }

            if (this.pendingTextureLoads.has(cacheKey)) {
                return;
            }

            this.pendingTextureLoads.add(cacheKey);

            fetch(`/api/file-preview?path=${encodeURIComponent(file.path)}&t=${Date.now()}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Image fetch failed');
                    }
                    return response.blob();
                })
                .then(blob => this.createImageBitmapFromBlob(blob))
                .then(bitmap => {
                    if (!bitmap) {
                        throw new Error('Bitmap creation failed');
                    }
                    const texture = this.createTextureFromBitmap(bitmap);
                    bitmap.close();
                    this.textureCache.set(cacheKey, texture);

                    if (building.userData.directoryToken === this.directoryToken && this.buildings.includes(building)) {
                        this.applyImageTexture(building, texture);
                    }
                })
                .catch(() => {
                    // fallback to hex texture
                    this.ensureBuildingGhost(building);
                    this.textureCache.set(cacheKey, null);
                    building.userData.textureState = 'image-missing';
                })
                .finally(() => {
                    this.pendingTextureLoads.delete(cacheKey);
                });
        }

        createImageBitmapFromBlob(blob) {
            if ('createImageBitmap' in window) {
                return createImageBitmap(blob);
            }

            return new Promise((resolve, reject) => {
                const img = new Image();
                const url = URL.createObjectURL(blob);
                img.onload = () => {
                    URL.revokeObjectURL(url);
                    resolve(img);
                };
                img.onerror = (err) => {
                    URL.revokeObjectURL(url);
                    reject(err);
                };
                img.src = url;
            });
        }

        createTextureFromBitmap(bitmap) {
            const size = 512;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, size, size);

            const srcSize = Math.min(bitmap.width, bitmap.height);
            const sx = (bitmap.width - srcSize) / 2;
            const sy = (bitmap.height - srcSize) / 2;

            ctx.drawImage(bitmap, sx, sy, srcSize, srcSize, 0, 0, size, size);

            const texture = new THREE.CanvasTexture(canvas);
            texture.encoding = THREE.sRGBEncoding;
            if (this.renderer) {
                texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            }
            texture.needsUpdate = true;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipMapLinearFilter;
            return texture;
        }

        applyImageTexture(building, texture) {
            if (!texture) {
                this.ensureBuildingGhost(building);
                return;
            }
            const { topMaterial, rimMaterial } = building.userData;
            topMaterial.map = texture;
            topMaterial.opacity = 1;
            topMaterial.needsUpdate = true;
            if (rimMaterial) {
                rimMaterial.map = texture;
                rimMaterial.opacity = 1;
                rimMaterial.needsUpdate = true;
            }
            building.userData.textureState = 'image';
        }

        getFileExtension(filename) {
            const idx = filename.lastIndexOf('.');
            if (idx === -1) return '';
            return filename.substring(idx + 1).toLowerCase();
        }

        stopMedia() {
            if (this.activeMedia === 'audio' && this.audioElement) {
                this.audioElement.pause();
                this.audioElement.removeAttribute('src');
                this.audioElement.load();
            }

            if (this.activeMedia === 'video' && this.videoElement && this.mediaBuilding) {
                this.videoElement.pause();
                this.videoElement.removeAttribute('src');
                this.videoElement.load();
                this.videoElement.currentTime = 0;
                if (this.videoTexture) {
                    this.videoTexture.needsUpdate = false;
                }
                if (this.mediaBuilding.userData) {
                    const { topMaterial, rimMaterial, previousMap, previousRimMap, previousState } = this.mediaBuilding.userData;
                    if (topMaterial) {
                        topMaterial.map = previousMap || topMaterial.map;
                        topMaterial.needsUpdate = true;
                    }
                    if (rimMaterial) {
                        rimMaterial.map = previousRimMap || rimMaterial.map;
                        rimMaterial.needsUpdate = true;
                    }
                    this.mediaBuilding.userData.textureState = previousState || 'ghost';
                    this.mediaBuilding.userData.previousMap = null;
                    this.mediaBuilding.userData.previousRimMap = null;
                    this.mediaBuilding.userData.previousState = null;
                }
            }

            this.activeMedia = null;
            this.mediaBuilding = null;
        }

        playAudio(building) {
            const file = building.userData.fileInfo;
            const src = `/api/file-preview?path=${encodeURIComponent(file.path)}&t=${Date.now()}`;
            this.stopMedia();

            if (!this.audioElement) return;
            this.audioElement.src = src;
            this.audioElement.play().catch(() => {});
            this.activeMedia = 'audio';
            this.mediaBuilding = building;
        }

        playVideo(building) {
            const file = building.userData.fileInfo;
            const src = `/api/file-preview?path=${encodeURIComponent(file.path)}&t=${Date.now()}`;
            this.stopMedia();

            if (!this.videoElement || !this.videoTexture) return;

            const { topMaterial, rimMaterial } = building.userData;
            building.userData.previousMap = topMaterial.map;
            building.userData.previousRimMap = rimMaterial ? rimMaterial.map : null;
            building.userData.previousState = building.userData.textureState;

            topMaterial.map = this.videoTexture;
            topMaterial.opacity = 1;
            topMaterial.needsUpdate = true;
            if (rimMaterial) {
                rimMaterial.map = this.videoTexture;
                rimMaterial.opacity = 1;
                rimMaterial.needsUpdate = true;
            }
            building.userData.textureState = 'video';

            this.videoElement.src = src;
            this.videoElement.currentTime = 0;
            this.videoElement.addEventListener('loadeddata', () => {
                if (this.activeMedia === 'video' && this.mediaBuilding === building) {
                    this.videoTexture.needsUpdate = true;
                }
            }, { once: true });
            this.videoElement.play().catch(() => {});

            this.activeMedia = 'video';
            this.mediaBuilding = building;
        }

    handleFileInteraction(building) {
        const file = building.userData.fileInfo;
        const ext = this.getFileExtension(file.name);

        if (['mp3', 'ogg'].includes(ext)) {
            this.playAudio(building);
            return;
        }

        if (['mp4'].includes(ext)) {
            this.playVideo(building);
            return;
        }

        // Non-media files: no popup, but ensure nothing is playing
        this.stopMedia();
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
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.updateCamera();
        this.updateParticles();
        this.updateBuildingTextures();

        if (this.activeMedia === 'video' && this.videoTexture) {
            if (this.videoElement && this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA && this.videoElement.videoWidth > 0) {
                this.videoTexture.needsUpdate = true;
            } else {
                this.videoTexture.needsUpdate = false;
            }
        }

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
            const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), this.roll);
            this.camera.quaternion.multiply(rollQuat);
        }

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

        const movement = new THREE.Vector3();
        movement.addScaledVector(forward, this.camera_velocity.z);
        movement.addScaledVector(right, this.camera_velocity.x);
        movement.addScaledVector(up, this.camera_velocity.y);

        this.camera.position.add(movement);

        document.getElementById('coordinates').textContent =
            `${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)}`;
    }
    
    updateParticles() {
        // Animate floating particles
        const time = Date.now() * 0.0005;
        this.scene.traverse((child) => {
            if (child instanceof THREE.Points) {
                const positions = child.geometry.attributes.position.array;
                for (let i = 0; i < positions.length; i += 3) {
                    positions[i + 1] += Math.sin(time + positions[i] * 0.01) * 0.01;
                }
                child.geometry.attributes.position.needsUpdate = true;
            }
        });
    }
    
    updateLoadingProgress(percent, status) {
        document.getElementById('progress-bar').style.width = percent + '%';
        document.getElementById('loading-status').textContent = status;
    }
    
    handleClick() {
        const building = this.getBuildingUnderCrosshair();
        if (!building) {
            return;
        }

        const fileInfo = building.userData.fileInfo;

        if (fileInfo.is_directory) {
            // Navigate to directory
            this.loadDirectory(fileInfo.path);

            // Add navigation effect
            this.addNavigationEffect(building);
        } else {
            this.handleFileInteraction(building);
        }
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
    
    addNavigationEffect(building) {
        // Create a pulsing teleportation effect
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
        
        // Animate the effect
        const startTime = Date.now();
        const duration = 1000;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress < 1) {
                effect.scale.setScalar(1 + progress * 3);
                effect.material.opacity = 0.8 * (1 - progress);
                effect.rotation.x += 0.1;
                effect.rotation.y += 0.15;
                requestAnimationFrame(animate);
            } else {
                this.scene.remove(effect);
                effect.geometry.dispose();
                effect.material.dispose();
            }
        };
        animate();
    }
    
    goToParentDirectory() {
        if (this.currentPath) {
            // Get parent path from current path
            const parentPath = this.currentPath.split('/').slice(0, -1).join('/');
            if (parentPath) {
                this.loadDirectory(parentPath);
            }
        }
    }
    
    goToHome() {
        this.loadDirectory(); // Load default (home) directory
    }

    applyFavouriteStyling(building, isFavourite) {
        if (!building || !building.userData) return;
        const { edgeMaterial, edgeBaseColor } = building.userData;
        if (!edgeMaterial) return;

        if (isFavourite) {
            edgeMaterial.color.setHex(this.colors.favourite);
            edgeMaterial.opacity = 1;
        } else {
            edgeMaterial.color.setHex(edgeBaseColor || this.colors.file);
            edgeMaterial.opacity = 1;
        }
        edgeMaterial.needsUpdate = true;
        building.userData.isFavourite = isFavourite;
    }

    async toggleFavourite(building) {
        if (!building || !building.userData || !building.userData.fileInfo) return;
        const path = building.userData.fileInfo.path;
        const shouldFavourite = !this.favourites.has(path);

        try {
            const response = await fetch('/api/favourites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, favourite: shouldFavourite })
            });

            if (!response.ok) {
                throw new Error('Failed to update favourite');
            }

            const data = await response.json();
            if (Array.isArray(data)) {
                this.favourites = new Set(data);
            }

            this.buildings.forEach((b) => {
                if (b.userData && b.userData.fileInfo && b.userData.fileInfo.path === path) {
                    this.applyFavouriteStyling(b, this.favourites.has(path));
                }
            });
        } catch (error) {
            console.warn('Failed to toggle favourite:', error);
        }
    }
}

// Initialize FileCity when page loads
document.addEventListener('DOMContentLoaded', () => {
    new FileCity();
});