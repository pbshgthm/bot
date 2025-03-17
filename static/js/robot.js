// Global variables and constants
let scene, camera, renderer, controls;
let baseYawGroup, pitch1Group, pitch2Group, pitch3Group;

// Color scheme - improved color harmony
const COLORS = {
  background: 0x121212, // Dark background
  base: 0x37474f, // Dark slate blue/gray
  servo: 0x6200ea, // Deep purple for servo cylinders
  joint: 0x00e5ff, // Cyan for joints
  arm: 0xff4081, // Pink for arms
  endEffector: 0xffab00, // Amber for end effector
  grid: 0x212121, // Dark gray for grid
  gridCenter: 0x424242, // Medium gray for grid center
  glow: 0x9c27b0, // Purple glow
};

// Material definitions with better metalness and glow
const MATERIALS = {
  base: new THREE.MeshStandardMaterial({
    color: COLORS.base,
    roughness: 0.5,
    metalness: 0.7,
  }),
  servo: new THREE.MeshStandardMaterial({
    color: COLORS.servo,
    roughness: 0.3,
    metalness: 0.8,
    emissive: COLORS.servo,
    emissiveIntensity: 0.2,
  }),
  joint: new THREE.MeshStandardMaterial({
    color: COLORS.joint,
    roughness: 0.2,
    metalness: 0.9,
    emissive: COLORS.joint,
    emissiveIntensity: 0.4,
  }),
  arm: new THREE.MeshStandardMaterial({
    color: COLORS.arm,
    roughness: 0.4,
    metalness: 0.6,
    emissive: COLORS.arm,
    emissiveIntensity: 0.1,
  }),
  endEffector: new THREE.MeshStandardMaterial({
    color: COLORS.endEffector,
    roughness: 0.2,
    metalness: 0.9,
    emissive: COLORS.endEffector,
    emissiveIntensity: 0.3,
  }),
  glow: new THREE.MeshBasicMaterial({
    color: COLORS.glow,
    transparent: true,
    opacity: 0.5,
  }),
};

// Dimensions - standardized arm lengths
const DIMENSIONS = {
  baseHeight: 0.5,
  baseRadius: 1.2,

  yawHeight: 0.8, // Shorter first segment
  yawRadius: 0.5,

  pitch1Length: 2.0,
  pitch1Width: 0.4,

  pitch2Length: 2.0, // Same length as pitch1
  pitch2Width: 0.35,

  pitch3Length: 2.0, // Same length as pitch1 and pitch2
  pitch3Width: 0.3,

  jointRadius: 0.4,
  jointThickness: 0.15,
};

// Initialize the scene
function init() {
  console.log("Initializing 3D scene");
  initScene();
  initCamera();
  initRenderer();
  initLights();
  initGrid();
  createRobot();
  setupEventListeners();
  fetchServoPositions();
  console.log("Setup complete");
}

// Initialize scene
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // Add subtle fog for depth perception
  scene.fog = new THREE.FogExp2(COLORS.background, 0.025);
}

// Initialize camera
function initCamera() {
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(6, 6, 6);
  camera.lookAt(0, 0, 0);
}

// Initialize renderer
function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setSize(
    document.getElementById("canvas-container").offsetWidth,
    window.innerHeight
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.physicallyCorrectLights = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  document.getElementById("canvas-container").appendChild(renderer.domElement);

  // Add orbit controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.minDistance = 2;
  controls.maxDistance = 20;
}

// Initialize lights
function initLights() {
  // Ambient light for base illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambientLight);

  // Main directional light with shadows
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 25;
  directionalLight.shadow.camera.left = -10;
  directionalLight.shadow.camera.right = 10;
  directionalLight.shadow.camera.top = 10;
  directionalLight.shadow.camera.bottom = -10;
  scene.add(directionalLight);

  // Add a second directional light from another angle
  const secondLight = new THREE.DirectionalLight(0xa080ff, 0.4);
  secondLight.position.set(-5, 5, -5);
  scene.add(secondLight);

  // Add a point light at the base for extra definition
  const pointLight = new THREE.PointLight(0xcc88ff, 0.6, 10);
  pointLight.position.set(0, 0, 0);
  scene.add(pointLight);
}

// Initialize grid
function initGrid() {
  // Add grid for reference
  const gridHelper = new THREE.GridHelper(
    20,
    20,
    COLORS.gridCenter,
    COLORS.grid
  );
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // Add axes helper for reference
  const axesHelper = new THREE.AxesHelper(3);
  scene.add(axesHelper);
}

// Set up event listeners
function setupEventListeners() {
  window.addEventListener("resize", onWindowResize);

  // Add slider event listeners
  const yawSlider = document.getElementById("base-yaw");
  yawSlider.addEventListener("input", handleYawSliderInput);

  const pitch1Slider = document.getElementById("pitch");
  pitch1Slider.addEventListener("input", handlePitch1SliderInput);

  const pitch2Slider = document.getElementById("pitch2");
  if (pitch2Slider) {
    pitch2Slider.addEventListener("input", handlePitch2SliderInput);
  }

  const pitch3Slider = document.getElementById("pitch3");
  if (pitch3Slider) {
    pitch3Slider.addEventListener("input", handlePitch3SliderInput);
  }

  // Add button event listeners
  const centerButton = document.getElementById("center-servos");
  if (centerButton) {
    centerButton.addEventListener("click", centerServos);
  }

  const refreshButton = document.getElementById("refresh-status");
  if (refreshButton) {
    refreshButton.addEventListener("click", fetchServoPositions);
  }
}

// Create disc-shaped servo joint oriented to its rotation axis
function createServoJoint(radius, height, color, axis = "y") {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.2,
    metalness: 0.9,
    emissive: color,
    emissiveIntensity: 0.4,
  });

  const cylinder = new THREE.Mesh(geometry, material);

  // Rotate cylinder to align with rotation axis
  if (axis === "x") {
    cylinder.rotation.z = Math.PI / 2; // Rotate to align with X axis
  } else if (axis === "z") {
    cylinder.rotation.x = Math.PI / 2; // Rotate to align with Z axis
  }

  cylinder.castShadow = true;
  return cylinder;
}

// Create the robot components
function createRobot() {
  console.log("Creating robot components");

  // Create base
  const baseGeometry = new THREE.CylinderGeometry(
    DIMENSIONS.baseRadius,
    DIMENSIONS.baseRadius * 1.1,
    DIMENSIONS.baseHeight,
    32
  );
  const base = new THREE.Mesh(baseGeometry, MATERIALS.base);
  base.position.y = DIMENSIONS.baseHeight / 2; // Half height
  base.castShadow = true;
  base.receiveShadow = true;
  scene.add(base);

  // Create a group for the yaw servo assembly (servo 1)
  baseYawGroup = new THREE.Group();
  baseYawGroup.position.y = DIMENSIONS.baseHeight; // Position at top of base
  scene.add(baseYawGroup);

  // Add a disc for the first servo joint (base yaw) - Y axis rotation
  const baseJoint = createServoJoint(
    DIMENSIONS.jointRadius,
    DIMENSIONS.jointThickness,
    COLORS.joint,
    "y"
  );
  baseYawGroup.add(baseJoint);

  // Create shorter cylinder for yaw servo
  const yawCylinderGeometry = new THREE.CylinderGeometry(
    DIMENSIONS.yawRadius,
    DIMENSIONS.yawRadius,
    DIMENSIONS.yawHeight,
    32
  );
  const yawCylinder = new THREE.Mesh(yawCylinderGeometry, MATERIALS.servo);
  yawCylinder.position.y = DIMENSIONS.yawHeight / 2; // Half its height
  yawCylinder.castShadow = true;
  baseYawGroup.add(yawCylinder);

  // Create a group for the first pitch servo assembly (servo 2)
  pitch1Group = new THREE.Group();
  pitch1Group.position.y = DIMENSIONS.yawHeight; // Position at top of yaw cylinder
  baseYawGroup.add(pitch1Group);

  // Add a disc for the second servo joint (pitch 1) - X axis rotation
  const pitch1Joint = createServoJoint(
    DIMENSIONS.jointRadius * 0.8,
    DIMENSIONS.jointThickness,
    COLORS.joint,
    "x"
  );
  pitch1Group.add(pitch1Joint);

  // Create arm segment for pitch1
  const arm1Geometry = new THREE.BoxGeometry(
    DIMENSIONS.pitch1Width,
    DIMENSIONS.pitch1Length,
    DIMENSIONS.pitch1Width
  );
  const arm1 = new THREE.Mesh(arm1Geometry, MATERIALS.arm);
  arm1.position.y = DIMENSIONS.pitch1Length / 2; // Half its height
  arm1.castShadow = true;
  pitch1Group.add(arm1);

  // Create a group for the second pitch servo assembly (servo 3)
  pitch2Group = new THREE.Group();
  pitch2Group.position.y = DIMENSIONS.pitch1Length; // Position at top of pitch1 arm
  pitch1Group.add(pitch2Group);

  // Add a disc for the third servo joint (pitch 2) - X axis rotation
  const pitch2Joint = createServoJoint(
    DIMENSIONS.jointRadius * 0.7,
    DIMENSIONS.jointThickness,
    COLORS.joint,
    "x"
  );
  pitch2Group.add(pitch2Joint);

  // Create arm segment for pitch2
  const arm2Geometry = new THREE.BoxGeometry(
    DIMENSIONS.pitch2Width,
    DIMENSIONS.pitch2Length,
    DIMENSIONS.pitch2Width
  );
  const arm2 = new THREE.Mesh(arm2Geometry, MATERIALS.arm);
  arm2.position.y = DIMENSIONS.pitch2Length / 2; // Half its height
  arm2.castShadow = true;
  pitch2Group.add(arm2);

  // Create a group for the third pitch servo assembly (servo 4)
  pitch3Group = new THREE.Group();
  pitch3Group.position.y = DIMENSIONS.pitch2Length; // Position at end of pitch2 arm
  pitch2Group.add(pitch3Group);

  // Add a disc for the fourth servo joint (pitch 3) - X axis rotation
  const pitch3Joint = createServoJoint(
    DIMENSIONS.jointRadius * 0.6,
    DIMENSIONS.jointThickness,
    COLORS.joint,
    "x"
  );
  pitch3Group.add(pitch3Joint);

  // Create arm segment for pitch3
  const arm3Geometry = new THREE.BoxGeometry(
    DIMENSIONS.pitch3Width,
    DIMENSIONS.pitch3Length,
    DIMENSIONS.pitch3Width
  );
  const arm3 = new THREE.Mesh(arm3Geometry, MATERIALS.arm);
  arm3.position.y = DIMENSIONS.pitch3Length / 2; // Half its height
  arm3.castShadow = true;
  pitch3Group.add(arm3);

  // Add end effector at the tip of the last arm
  const endEffectorGeometry = new THREE.SphereGeometry(0.25, 24, 24);
  const endEffector = new THREE.Mesh(
    endEffectorGeometry,
    MATERIALS.endEffector
  );
  endEffector.position.y = DIMENSIONS.pitch3Length; // Top of the arm
  endEffector.castShadow = true;

  // Add a small light at the end effector
  const endEffectorLight = new THREE.PointLight(COLORS.endEffector, 1, 3);
  endEffectorLight.position.y = 0;
  endEffector.add(endEffectorLight);

  // Add glow effect around end effector
  const glowGeometry = new THREE.SphereGeometry(0.35, 24, 24);
  const glowMesh = new THREE.Mesh(glowGeometry, MATERIALS.glow);
  endEffector.add(glowMesh);

  pitch3Group.add(endEffector);

  // Initial rotations
  pitch1Group.rotation.x = 0; // Start pointing up
  pitch2Group.rotation.x = Math.PI / 2; // At 0 degrees, perpendicular to pitch1
  pitch3Group.rotation.x = 0; // Perpendicular to pitch2 at 0

  console.log("Robot created");
}

// Handle yaw slider input
function handleYawSliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("base-yaw-value").textContent = value + "°";
  rotateYawServo(value);
  updateServoPosition("base_yaw", value);
}

// Handle pitch1 slider input
function handlePitch1SliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("pitch-value").textContent = value + "°";
  rotatePitch1Servo(value);
  updateServoPosition("pitch", value);
}

// Handle pitch2 slider input
function handlePitch2SliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("pitch2-value").textContent = value + "°";
  rotatePitch2Servo(value);
  updateServoPosition("pitch2", value);
}

// Handle pitch3 slider input
function handlePitch3SliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("pitch3-value").textContent = value + "°";
  rotatePitch3Servo(value);
  updateServoPosition("pitch3", value);
}

// Servo rotation functions
function rotateYawServo(degrees) {
  if (!baseYawGroup) return;
  const radians = (degrees * Math.PI) / 180;
  baseYawGroup.rotation.y = radians;
}

function rotatePitch1Servo(degrees) {
  if (!pitch1Group) return;
  const radians = (degrees * Math.PI) / 180;
  pitch1Group.rotation.x = radians;
}

function rotatePitch2Servo(degrees) {
  if (!pitch2Group) return;
  const radians = (degrees * Math.PI) / 180;
  // Special rotation for pitch2: 0° is perpendicular to pitch1
  pitch2Group.rotation.x = Math.PI / 2 - radians;
}

function rotatePitch3Servo(degrees) {
  if (!pitch3Group) return;
  const radians = (degrees * Math.PI) / 180;
  pitch3Group.rotation.x = radians;
}

// Center all servos
function centerServos() {
  console.log("Centering all servos");
  updateSliderValue("base-yaw", 0);
  updateSliderValue("pitch", 0);
  updateSliderValue("pitch2", 0);
  updateSliderValue("pitch3", 0);

  // Update 3D model
  rotateYawServo(0);
  rotatePitch1Servo(0);
  rotatePitch2Servo(0);
  rotatePitch3Servo(0);

  // Send to server
  fetch("/api/servo/center", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log("Center servos response:", data);
      updateServerResponse(data);
      updateLastUpdated();
    })
    .catch((error) => {
      console.error("Error centering servos:", error);
      updateServerResponse("Error: " + error.message);
    });
}

// Update slider value helper
function updateSliderValue(sliderId, value) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;

  slider.value = value;
  const valueDisplay = document.getElementById(`${sliderId}-value`);
  if (valueDisplay) valueDisplay.textContent = value + "°";
}

// Fetch current servo positions from server
function fetchServoPositions() {
  console.log("Fetching servo positions from server");
  updateConnectionStatus("Connecting...");

  fetch("/api/servo/positions")
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      updateConnectionStatus("Connected");
      return response.json();
    })
    .then((data) => {
      console.log("Received servo positions:", data);
      updateServerResponse(data);
      updateLastUpdated();

      // Update sliders and 3D model
      if (data.base_yaw !== undefined) {
        updateSliderValue("base-yaw", data.base_yaw);
        rotateYawServo(data.base_yaw);
      }

      if (data.pitch !== undefined) {
        updateSliderValue("pitch", data.pitch);
        rotatePitch1Servo(data.pitch);
      }

      if (data.pitch2 !== undefined) {
        updateSliderValue("pitch2", data.pitch2);
        rotatePitch2Servo(data.pitch2);
      }

      if (data.pitch3 !== undefined) {
        updateSliderValue("pitch3", data.pitch3);
        rotatePitch3Servo(data.pitch3);
      }
    })
    .catch((error) => {
      console.error("Error fetching servo positions:", error);
      updateConnectionStatus("Disconnected");
      updateServerResponse("Error: " + error.message);
    });
}

// Send updated servo position to server
function updateServoPosition(servoId, position) {
  console.log(`Sending ${servoId} position update to server: ${position}°`);

  fetch("/api/servo/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      servo_id: servoId,
      position: position,
    }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then((data) => {
      console.log("Server response:", data);
      updateServerResponse(data);
      updateLastUpdated();
    })
    .catch((error) => {
      console.error("Error updating servo position:", error);
      updateServerResponse("Error: " + error.message);
    });
}

// Handle window resize
function onWindowResize() {
  camera.aspect =
    document.getElementById("canvas-container").offsetWidth /
    window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(
    document.getElementById("canvas-container").offsetWidth,
    window.innerHeight
  );
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Helper functions for server status updates
function updateConnectionStatus(status) {
  const statusElement = document.getElementById("connection-status");
  if (statusElement) {
    statusElement.textContent = status;

    // Remove all classes first
    statusElement.classList.remove("connecting", "connected", "disconnected");

    // Add appropriate class
    if (status === "Connecting...") {
      statusElement.classList.add("connecting");
    } else if (status === "Connected") {
      statusElement.classList.add("connected");
    } else {
      statusElement.classList.add("disconnected");
    }
  }
}

function updateLastUpdated() {
  const element = document.getElementById("last-updated");
  if (element) {
    const now = new Date();
    element.textContent = now.toLocaleTimeString();
  }
}

function updateServerResponse(response) {
  const element = document.getElementById("server-response");
  if (element) {
    element.textContent =
      typeof response === "object"
        ? JSON.stringify(response, null, 2)
        : response;
  }
}

// Start the application when the page loads
window.addEventListener("DOMContentLoaded", function () {
  console.log("DOM loaded - starting application");
  init();
  animate();
});

// Log that the script has loaded
console.log("Robot.js loaded successfully");
