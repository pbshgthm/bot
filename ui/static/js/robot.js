// Global variables and constants
let scene, camera, renderer, controls;
let baseYawGroup,
  pitch1Group,
  pitch2Group,
  pitch3Group,
  rollGroup,
  gripperGroup;

// Color scheme - improved color contrast and visibility
const COLORS = {
  background: 0x1a1a1a, // Dark gray background
  base: 0x455a64, // Darker blue/gray for base
  servo: 0x5c6bc0, // Brighter indigo for servo cylinders
  joint: 0x29b6f6, // Bright blue for joints
  arm: 0x9575cd, // Lighter purple for arms - better contrast
  endEffector: 0xff9800, // Brighter orange for end effector
  grid: 0x212121, // Dark gray for grid
  gridCenter: 0x424242, // Medium gray for grid center
  glow: 0xb388ff, // Brighter purple glow
  transparent: 0x80deea, // Transparent cyan for rotation discs
  highlight: 0xd1c4e9, // Highlight color for edges
};

// Material definitions with better contrast and glow
const MATERIALS = {
  base: new THREE.MeshStandardMaterial({
    color: COLORS.base,
    roughness: 0.4,
    metalness: 0.8,
    emissive: 0x263238,
    emissiveIntensity: 0.1,
  }),
  servo: new THREE.MeshStandardMaterial({
    color: COLORS.servo,
    roughness: 0.3,
    metalness: 0.9,
    emissive: COLORS.servo,
    emissiveIntensity: 0.3,
  }),
  joint: new THREE.MeshStandardMaterial({
    color: COLORS.joint,
    roughness: 0.2,
    metalness: 0.9,
    emissive: COLORS.joint,
    emissiveIntensity: 0.6,
  }),
  arm: new THREE.MeshStandardMaterial({
    color: COLORS.arm,
    roughness: 0.3,
    metalness: 0.7,
    emissive: COLORS.arm,
    emissiveIntensity: 0.3,
  }),
  endEffector: new THREE.MeshStandardMaterial({
    color: COLORS.endEffector,
    roughness: 0.2,
    metalness: 0.9,
    emissive: COLORS.endEffector,
    emissiveIntensity: 0.5,
  }),
  glow: new THREE.MeshBasicMaterial({
    color: COLORS.glow,
    transparent: true,
    opacity: 0.7,
  }),
  transparent: new THREE.MeshStandardMaterial({
    color: COLORS.transparent,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
    metalness: 0.9,
    emissive: COLORS.transparent,
    emissiveIntensity: 0.3,
  }),
};

// Dimensions - updated with thicker components
const DIMENSIONS = {
  baseHeight: 1.2,
  baseRadius: 2.5,

  yawHeight: 4.0, // First cylinder should be 4 units
  yawRadius: 1.5,

  pitch1Length: 18.0, // Second segment 18 units
  pitch1Width: 3.0, // Increased to 3 units thick

  pitch2Length: 18.0, // Third segment 18 units
  pitch2Width: 3.0, // Increased to 3 units thick

  pitch3Length: 5.0, // Fourth segment 5 units
  pitch3Width: 3.0, // Increased to 3 units thick

  rollLength: 4.0, // Length for the roll section
  rollWidth: 3.0, // Width for the roll section

  gripperLength: 3.0, // Length of gripper housing
  gripperWidth: 2.5, // Width of gripper housing
  gripperFingerLength: 2.0, // Length of gripper fingers
  gripperFingerWidth: 0.8, // Width of gripper fingers
  gripperOpenAngle: 30, // Angle in degrees for open gripper

  jointRadius: 2.0, // Larger joints
  jointThickness: 0.6,
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
  scene.fog = new THREE.FogExp2(COLORS.background, 0.006);
}

// Initialize camera
function initCamera() {
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(40, 25, 40);
  camera.lookAt(0, 20, 0);
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
  renderer.toneMappingExposure = 1.4; // Increased exposure for better visibility

  document.getElementById("canvas-container").appendChild(renderer.domElement);

  // Add orbit controls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.minDistance = 10;
  controls.maxDistance = 120;
}

// Initialize lights
function initLights() {
  // Ambient light for base illumination - increased for better visibility
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // Main directional light with shadows
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
  directionalLight.position.set(20, 30, 20);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 100;
  directionalLight.shadow.camera.left = -50;
  directionalLight.shadow.camera.right = 50;
  directionalLight.shadow.camera.top = 50;
  directionalLight.shadow.camera.bottom = -50;
  scene.add(directionalLight);

  // Add a second directional light from another angle
  const secondLight = new THREE.DirectionalLight(0xbbdefb, 0.6);
  secondLight.position.set(-25, 20, -20);
  scene.add(secondLight);

  // Add a point light at the base for extra definition
  const pointLight = new THREE.PointLight(0xb388ff, 0.8, 40);
  pointLight.position.set(0, 5, 0);
  scene.add(pointLight);

  // Add a rim light to highlight edges
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
  rimLight.position.set(0, 10, -30);
  scene.add(rimLight);
}

// Initialize grid
function initGrid() {
  // Add grid for reference
  const gridHelper = new THREE.GridHelper(
    100,
    50,
    COLORS.gridCenter,
    COLORS.grid
  );
  gridHelper.position.y = 0;
  scene.add(gridHelper);

  // Add axes helper for reference
  const axesHelper = new THREE.AxesHelper(10);
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

  const rollSlider = document.getElementById("roll");
  if (rollSlider) {
    rollSlider.addEventListener("input", handleRollSliderInput);
  }

  const gripperSlider = document.getElementById("pitch4");
  if (gripperSlider) {
    gripperSlider.addEventListener("input", handleGripperSliderInput);
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
function createServoJoint(radius, height, axis = "y") {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
  const cylinder = new THREE.Mesh(geometry, MATERIALS.transparent);

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
    DIMENSIONS.baseRadius * 1.2,
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
    DIMENSIONS.jointRadius * 1.5,
    DIMENSIONS.jointThickness,
    "y"
  );
  baseYawGroup.add(baseJoint);

  // Create cylinder for yaw servo - 4 units tall
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
    DIMENSIONS.jointRadius * 1.3,
    DIMENSIONS.jointThickness,
    "x"
  );
  pitch1Group.add(pitch1Joint);

  // Create arm segment for pitch1 - now 18 units long and 3 units thick
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
    DIMENSIONS.jointRadius * 1.2,
    DIMENSIONS.jointThickness,
    "x"
  );
  pitch2Group.add(pitch2Joint);

  // Create arm segment for pitch2 - now 18 units long and 3 units thick
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
    DIMENSIONS.jointRadius,
    DIMENSIONS.jointThickness,
    "x"
  );
  pitch3Group.add(pitch3Joint);

  // Create arm segment for pitch3 - now 5 units long and 3 units thick
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
  const endEffectorGeometry = new THREE.SphereGeometry(1.2, 24, 24);

  // Create a group for the roll servo assembly (servo 5)
  rollGroup = new THREE.Group();
  rollGroup.position.y = DIMENSIONS.pitch3Length; // Position at end of pitch3 arm
  pitch3Group.add(rollGroup);

  // Add a disc for roll joint - Y axis rotation
  const rollJoint = createServoJoint(
    DIMENSIONS.jointRadius * 0.9,
    DIMENSIONS.jointThickness,
    "y" // Y-axis for roll around the arm's length
  );
  rollGroup.add(rollJoint);

  // Add visual indicators for roll rotation
  // Create a cylindrical housing for the roll section
  const rollHousingGeometry = new THREE.CylinderGeometry(
    DIMENSIONS.rollWidth / 2,
    DIMENSIONS.rollWidth / 2,
    DIMENSIONS.rollLength,
    16
  );
  const rollHousing = new THREE.Mesh(rollHousingGeometry, MATERIALS.servo);
  rollHousing.position.y = DIMENSIONS.rollLength / 2;
  rollHousing.castShadow = true;
  rollGroup.add(rollHousing);

  // Add directional markers on the roll housing to show rotation
  const markerGeometry = new THREE.BoxGeometry(0.4, 0.2, 2.5);
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3333, // Red marker
    roughness: 0.3,
    metalness: 0.8,
    emissive: 0xff3333,
    emissiveIntensity: 0.5,
  });

  // Add multiple markers around the roll cylinder
  const marker1 = new THREE.Mesh(markerGeometry, markerMaterial);
  marker1.position.set(
    0,
    DIMENSIONS.rollLength / 2,
    DIMENSIONS.rollWidth / 2 + 0.01
  );
  rollHousing.add(marker1);

  const marker2 = new THREE.Mesh(markerGeometry, markerMaterial);
  marker2.position.set(
    0,
    DIMENSIONS.rollLength / 2,
    -(DIMENSIONS.rollWidth / 2 + 0.01)
  );
  marker2.rotation.x = Math.PI;
  rollHousing.add(marker2);

  // Create a group for the gripper assembly (servo 6)
  gripperGroup = new THREE.Group();
  gripperGroup.position.y = DIMENSIONS.rollLength;
  rollGroup.add(gripperGroup);

  // Add a housing for the gripper
  const gripperHousingGeometry = new THREE.BoxGeometry(
    DIMENSIONS.gripperWidth,
    DIMENSIONS.gripperLength,
    DIMENSIONS.gripperWidth
  );
  const gripperHousing = new THREE.Mesh(
    gripperHousingGeometry,
    MATERIALS.servo
  );
  gripperHousing.position.y = DIMENSIONS.gripperLength / 2;
  gripperHousing.castShadow = true;
  gripperGroup.add(gripperHousing);

  // Create left gripper finger
  const leftFingerGeometry = new THREE.BoxGeometry(
    DIMENSIONS.gripperFingerWidth,
    DIMENSIONS.gripperFingerLength,
    DIMENSIONS.gripperFingerWidth
  );
  const leftFinger = new THREE.Mesh(leftFingerGeometry, MATERIALS.endEffector);
  leftFinger.position.set(
    -DIMENSIONS.gripperWidth / 2 - DIMENSIONS.gripperFingerWidth / 2,
    DIMENSIONS.gripperLength / 2,
    0
  );
  leftFinger.castShadow = true;
  gripperGroup.add(leftFinger);

  // Create right gripper finger
  const rightFingerGeometry = new THREE.BoxGeometry(
    DIMENSIONS.gripperFingerWidth,
    DIMENSIONS.gripperFingerLength,
    DIMENSIONS.gripperFingerWidth
  );
  const rightFinger = new THREE.Mesh(
    rightFingerGeometry,
    MATERIALS.endEffector
  );
  rightFinger.position.set(
    DIMENSIONS.gripperWidth / 2 + DIMENSIONS.gripperFingerWidth / 2,
    DIMENSIONS.gripperLength / 2,
    0
  );
  rightFinger.castShadow = true;
  gripperGroup.add(rightFinger);

  // Store references to gripper fingers for animation
  gripperGroup.leftFinger = leftFinger;
  gripperGroup.rightFinger = rightFinger;

  // Initial rotations
  pitch1Group.rotation.x = 0; // Start pointing up
  pitch2Group.rotation.x = Math.PI / 2; // At 0 degrees, perpendicular to pitch1
  pitch3Group.rotation.x = 0; // Perpendicular to pitch2 at 0
  rollGroup.rotation.y = 0; // No roll initially

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

// Handle roll slider input
function handleRollSliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("roll-value").textContent = value + "°";
  rotateRollServo(value);
  updateServoPosition("pitch4", value);
}

// Handle gripper slider input
function handleGripperSliderInput(event) {
  const value = parseFloat(event.target.value);
  document.getElementById("pitch4-value").textContent = value + "°";
  moveGripper(value);
  updateServoPosition("pitch5", value);
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

// Roll rotation function
function rotateRollServo(degrees) {
  if (!rollGroup) return;
  const radians = (degrees * Math.PI) / 180;
  rollGroup.rotation.y = radians;
}

// Gripper movement function
function moveGripper(value) {
  if (!gripperGroup || !gripperGroup.leftFinger || !gripperGroup.rightFinger)
    return;

  // Map the -90 to 90 range to gripper positions
  // 0 is closed, negative values open one way, positive values open the other way
  const openAmount = Math.abs(value) / 90; // 0 to 1 based on slider position

  // Position the fingers
  const offset =
    DIMENSIONS.gripperWidth / 2 + DIMENSIONS.gripperFingerWidth / 2;
  const openOffset = offset + openAmount * DIMENSIONS.gripperFingerWidth * 1.5;

  gripperGroup.leftFinger.position.x = -openOffset;
  gripperGroup.rightFinger.position.x = openOffset;
}

// Center all servos
function centerServos() {
  console.log("Centering all servos");
  updateSliderValue("base-yaw", 0);
  updateSliderValue("pitch", 0);
  updateSliderValue("pitch2", 0);
  updateSliderValue("pitch3", 0);
  updateSliderValue("roll", 0);
  updateSliderValue("pitch4", 0); // Gripper slider

  // Update 3D model
  rotateYawServo(0);
  rotatePitch1Servo(0);
  rotatePitch2Servo(0);
  rotatePitch3Servo(0);
  rotateRollServo(0);
  moveGripper(0); // Close gripper

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

      if (data.pitch4 !== undefined) {
        updateSliderValue("roll", data.pitch4);
        rotateRollServo(data.pitch4);
      }

      if (data.pitch5 !== undefined) {
        updateSliderValue("pitch4", data.pitch5);
        moveGripper(data.pitch5);
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
