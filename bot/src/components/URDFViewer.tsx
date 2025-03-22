import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import URDFLoader from "urdf-loader";

// Extended types for URDF objects to match urdf-loader library types
interface URDFJoint extends THREE.Object3D {
  isURDFJoint: boolean;
  jointType: string;
  jointValue: any; // Use 'any' to accommodate both number and Number[] types
  setJointValue: (value: number) => void;
  limit?: { lower: number; upper: number }; // Add optional limit property
  axis?: THREE.Vector3; // Add optional axis property
}

interface URDFLink extends THREE.Object3D {
  isURDFLink: boolean;
}

interface URDFRobot extends THREE.Object3D {
  joints: { [key: string]: URDFJoint }; // Match exact type from library
  links: { [key: string]: URDFLink };
}

// URDF Drag Controls - reimplemented to exactly match the example
class URDFDragControls {
  raycaster: THREE.Raycaster;
  robot: URDFRobot | null;
  hovered: URDFJoint | null;
  grabbed: boolean;
  manipulating: boolean;
  hitDistance: number;
  onHover: (joint: URDFJoint) => void;
  onUnhover: (joint: URDFJoint) => void;
  dispatchEvent: (eventName: string, jointName: string) => void;
  lastHoveredJoint: URDFJoint | null = null;
  selectionTimeout: number | null = null;

  // New tracking variables for smoother manipulation
  startJointValue: number = 0;
  startIntersection: THREE.Vector3 | null = null;
  lastValidRayDirection: THREE.Vector3 | null = null;
  rotationAxis: THREE.Vector3 | null = null;
  lastValidAngle: number = 0;

  constructor(
    robotGroup: URDFRobot | null,
    dispatchEvent: (eventName: string, jointName: string) => void
  ) {
    this.raycaster = new THREE.Raycaster();
    this.robot = robotGroup;
    this.hovered = null;
    this.grabbed = false;
    this.manipulating = false;
    this.hitDistance = 0;
    this.onHover = () => {};
    this.onUnhover = () => {};
    this.dispatchEvent = dispatchEvent;
    this.lastHoveredJoint = null;
    this.selectionTimeout = null;
    this.startIntersection = null;
    this.lastValidRayDirection = null;
    this.rotationAxis = null;
  }

  moveRay(ray: THREE.Ray) {
    this.raycaster.ray.copy(ray);

    if (!this.robot) return;

    // If we're grabbing something then manipulate it
    if (this.grabbed && this.hovered) {
      this.manipulating = true;

      // Calculate joint position in world space
      const jointWorldPos = new THREE.Vector3();
      this.hovered.getWorldPosition(jointWorldPos);

      if (this.hovered.jointType !== "fixed") {
        // Get the joint's rotation axis in world coordinates
        if (!this.rotationAxis) {
          // Use the axis from the URDF if available
          if (this.hovered.axis) {
            // Convert joint's local axis to world space
            this.rotationAxis = this.hovered.axis.clone();
            // Need to apply parent world transformation to get axis in world space
            const worldMatrix = new THREE.Matrix4();
            this.hovered.updateWorldMatrix(true, false);
            worldMatrix.extractRotation(this.hovered.matrixWorld);
            this.rotationAxis.applyMatrix4(worldMatrix);
          } else {
            // Default to X axis if no axis defined
            this.rotationAxis = new THREE.Vector3(1, 0, 0);
            const worldMatrix = new THREE.Matrix4();
            this.hovered.updateWorldMatrix(true, false);
            worldMatrix.extractRotation(this.hovered.matrixWorld);
            this.rotationAxis.applyMatrix4(worldMatrix);
          }
          // Ensure it's normalized
          this.rotationAxis.normalize();

          // For debugging
          console.log(
            `Joint ${this.hovered.name} rotation axis:`,
            this.rotationAxis.x.toFixed(4),
            this.rotationAxis.y.toFixed(4),
            this.rotationAxis.z.toFixed(4)
          );
        }

        // For revolute and continuous joints
        if (
          this.hovered.jointType === "revolute" ||
          this.hovered.jointType === "continuous"
        ) {
          // Create a plane perpendicular to the rotation axis, passing through the joint center
          const planeNormal = this.rotationAxis.clone();
          const planePoint = jointWorldPos.clone();

          // Calculate plane constant for intersection formula
          const planeConstant = -planeNormal.dot(planePoint);

          // Calculate ray-plane intersection
          const rayOriginDotNormal = ray.origin.dot(planeNormal);
          const rayDirectionDotNormal = ray.direction.dot(planeNormal);

          // Only proceed if ray isn't parallel to the plane
          if (Math.abs(rayDirectionDotNormal) > 0.001) {
            // Calculate distance along ray to intersection
            const t =
              -(rayOriginDotNormal + planeConstant) / rayDirectionDotNormal;

            // Ensure intersection is in front of the camera (t > 0)
            if (t > 0) {
              // Calculate intersection point
              const intersectionPoint = ray.origin
                .clone()
                .add(ray.direction.clone().multiplyScalar(t));

              // If first interaction, initialize tracking variables
              if (!this.startIntersection) {
                this.startIntersection = intersectionPoint.clone();
                this.startJointValue =
                  typeof this.hovered.jointValue === "number"
                    ? this.hovered.jointValue
                    : this.hovered.jointValue[0];
                return;
              }

              // Calculate vectors from joint center to intersection points
              const v1 = this.startIntersection.clone().sub(jointWorldPos);
              const v2 = intersectionPoint.clone().sub(jointWorldPos);

              // Project vectors onto the rotation plane
              v1.projectOnPlane(planeNormal).normalize();
              v2.projectOnPlane(planeNormal).normalize();

              if (v1.length() < 0.001 || v2.length() < 0.001) {
                return; // Skip if projection is too small
              }

              // Calculate signed angle between these vectors in the rotation plane
              // First get the raw angle
              let angle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));

              // Determine the sign of rotation
              const cross = new THREE.Vector3().crossVectors(v1, v2);
              if (cross.dot(planeNormal) < 0) {
                angle = -angle;
              }

              // Scale angle for pitch joints to match expected behavior
              // Special handling for pitch joints which may need different sensitivity
              if (this.hovered.name.includes("pitch")) {
                // For pitch joints, we might need to adjust sensitivity or rotation direction
                // This depends on how the URDF has defined the pitch joints
                if (
                  this.hovered.name.includes("2-pitch") ||
                  this.hovered.name.includes("3-pitch")
                ) {
                  // These specific joints may need special handling
                  console.log(
                    `Pitch joint ${this.hovered.name}, angle before: ${angle}`
                  );
                  // Adjust angle calculation based on joint's actual axis
                  const axisY = Math.abs(this.rotationAxis.y);
                  if (axisY > 0.9) {
                    // If primarily Y-axis rotation, we might need to flip the sign
                    angle = -angle; // Only flip for Y-dominant axis
                  }
                  console.log(
                    `Pitch joint ${this.hovered.name}, angle after: ${angle}`
                  );
                }
              }

              // Calculate new joint value
              let newValue = this.startJointValue + angle;

              // Apply joint limits for revolute joints
              if (this.hovered.jointType === "revolute" && this.hovered.limit) {
                const lower = this.hovered.limit.lower;
                const upper = this.hovered.limit.upper;

                // Log limits for debugging
                console.log(
                  `Joint ${this.hovered.name} limits: [${lower}, ${upper}], current: ${newValue}`
                );

                // Apply limits more intelligently
                if (newValue < lower) {
                  newValue = lower;
                } else if (newValue > upper) {
                  newValue = upper;
                }
              }

              // Only update if there's meaningful change
              if (Math.abs(newValue - this.lastValidAngle) > 0.0001) {
                // Update joint value
                this.hovered.setJointValue(newValue);
                this.lastValidAngle = newValue;

                // Dispatch event to update UI
                this.dispatchEvent("angle-change", this.hovered.name);
              }
            }
          }
        }
        // For prismatic joints
        else if (this.hovered.jointType === "prismatic") {
          // Get closest point on ray to joint
          const closestPoint = new THREE.Vector3();
          const line = new THREE.Line3(
            ray.origin,
            ray.origin.clone().add(ray.direction)
          );
          line.closestPointToPoint(jointWorldPos, false, closestPoint);

          // Initialize on first interaction
          if (!this.startIntersection) {
            this.startIntersection = closestPoint.clone();
            this.startJointValue =
              typeof this.hovered.jointValue === "number"
                ? this.hovered.jointValue
                : this.hovered.jointValue[0];
            return;
          }

          // Calculate movement along axis
          const movement = closestPoint.clone().sub(this.startIntersection);
          const distance = movement.dot(this.rotationAxis);

          // Scale movement appropriately for prismatic joints
          const scale = 0.01; // Adjust sensitivity as needed
          let newValue = this.startJointValue + distance * scale;

          // Apply limits if available
          if (this.hovered.limit) {
            const lower = this.hovered.limit.lower;
            const upper = this.hovered.limit.upper;

            if (newValue < lower) {
              newValue = lower;
            } else if (newValue > upper) {
              newValue = upper;
            }
          }

          // Only update if significant change
          if (Math.abs(newValue - this.lastValidAngle) > 0.0001) {
            this.hovered.setJointValue(newValue);
            this.lastValidAngle = newValue;
            this.dispatchEvent("angle-change", this.hovered.name);
          }
        }
      }
      return;
    }

    // Only check for hover changes when not manipulating
    if (!this.manipulating) {
      // Use a single raycaster to find all intersections
      const meshes: THREE.Mesh[] = [];

      // First collect all meshes in the robot
      this.robot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          meshes.push(obj);
        }
      });

      // Cast ray against all meshes
      const intersects = this.raycaster.intersectObjects(meshes, false);

      // Find the nearest intersected joint
      let nearestJoint: URDFJoint | null = null;

      if (intersects.length > 0) {
        // Start at the intersected object and traverse up to find a joint
        let current: THREE.Object3D | null = intersects[0].object;

        while (current && current !== this.robot) {
          // Check if this is a joint and not fixed
          if (
            (current as any).isURDFJoint &&
            (current as any).jointType !== "fixed"
          ) {
            nearestJoint = current as URDFJoint;
            break;
          }
          current = current.parent;
        }
      }

      // Simpler, more stable hover logic
      if (nearestJoint !== this.hovered) {
        // Clear any pending timeouts to prevent flicker
        if (this.selectionTimeout) {
          clearTimeout(this.selectionTimeout);
          this.selectionTimeout = null;
        }

        // If we have a previously hovered joint that's different, unhover it
        if (this.hovered) {
          this.onUnhover(this.hovered);
          this.hovered = null;
        }

        // If we found a new joint, hover it
        if (nearestJoint) {
          this.hovered = nearestJoint;
          this.onHover(nearestJoint);
        }
      }
    }
  }

  setGrabbed(grabbed: boolean) {
    // When grabbing, lock in the current hover state
    if (grabbed && this.hovered) {
      // Clear any pending hover changes
      if (this.selectionTimeout) {
        clearTimeout(this.selectionTimeout);
        this.selectionTimeout = null;
      }

      // Reset tracking variables
      this.startIntersection = null;
      this.rotationAxis = null;
      this.lastValidAngle =
        typeof this.hovered.jointValue === "number"
          ? this.hovered.jointValue
          : this.hovered.jointValue[0];

      this.grabbed = true;
      // Dispatch manipulate-start event
      this.dispatchEvent("manipulate-start", this.hovered.name);
    }
    // When releasing
    else if (!grabbed) {
      this.grabbed = false;

      if (this.manipulating && this.hovered) {
        // Dispatch manipulate-end event
        this.dispatchEvent("manipulate-end", this.hovered.name);
      }

      this.manipulating = false;

      // Clear tracking variables
      this.startIntersection = null;
      this.rotationAxis = null;
    }
  }
}

interface URDFViewerProps {
  onRobotLoaded?: (robot: URDFRobot) => void;
}

const URDFViewer = ({ onRobotLoaded }: URDFViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const isLoadingRef = useRef<boolean>(false);
  const modelLoadedRef = useRef<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dragControlsRef = useRef<URDFDragControls | null>(null);
  const rayRef = useRef<THREE.Ray>(new THREE.Ray());
  const [debugInfo, setDebugInfo] = useState("");
  const originalNoAutoRecenterRef = useRef<boolean>(false);
  const hoverMaterialRef = useRef<THREE.MeshPhongMaterial | null>(null);
  const [webGLSupported, setWebGLSupported] = useState(true);

  // Check WebGL support
  useEffect(() => {
    // Check if WebGL is supported
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        setWebGLSupported(false);
        setError("WebGL not supported - 3D visualization unavailable");
      }
    } catch (e) {
      setWebGLSupported(false);
      setError("WebGL not supported - 3D visualization unavailable");
    }
  }, []);

  // Function to clean up any existing robot model
  const cleanupExistingModel = () => {
    if (robotRef.current && sceneRef.current) {
      console.log("Cleaning up existing robot model");

      // Remove from scene first
      sceneRef.current.remove(robotRef.current);

      // Dispose of geometries and materials
      robotRef.current.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry) {
            obj.geometry.dispose();
          }

          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((material) => material.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });

      // Clear reference
      robotRef.current = null;
      modelLoadedRef.current = false;
    }
  };

  // Custom event dispatcher
  const dispatchCustomEvent = (eventName: string, jointName: string) => {
    if (eventName === "manipulate-start") {
      originalNoAutoRecenterRef.current = true; // Save original state
      if (containerRef.current) {
        const event = new CustomEvent("manipulate-start", {
          detail: jointName,
        });
        containerRef.current.dispatchEvent(event);
      }
    } else if (eventName === "manipulate-end") {
      if (containerRef.current) {
        const event = new CustomEvent("manipulate-end", { detail: jointName });
        containerRef.current.dispatchEvent(event);
      }
    } else if (eventName === "joint-mouseover") {
      if (containerRef.current) {
        const event = new CustomEvent("joint-mouseover", { detail: jointName });
        containerRef.current.dispatchEvent(event);
      }
    } else if (eventName === "joint-mouseout") {
      if (containerRef.current) {
        const event = new CustomEvent("joint-mouseout", { detail: jointName });
        containerRef.current.dispatchEvent(event);
      }
    } else if (eventName === "angle-change") {
      if (containerRef.current) {
        const event = new CustomEvent("angle-change", { detail: jointName });
        containerRef.current.dispatchEvent(event);
      }
    }
  };

  // Listen for angle-change events and handle them to update UI
  useEffect(() => {
    const handleAngleChange = (e: CustomEvent) => {
      if (!robotRef.current) return;

      const jointName = e.detail;
      // Force a re-render to update the sliders if needed
      if (onRobotLoaded && robotRef.current) {
        // This will trigger the RobotControls component to update
        onRobotLoaded(robotRef.current);
      }
    };

    // Add event listener
    containerRef.current?.addEventListener(
      "angle-change",
      handleAngleChange as EventListener
    );

    return () => {
      // Remove event listener on cleanup
      containerRef.current?.removeEventListener(
        "angle-change",
        handleAngleChange as EventListener
      );
    };
  }, [onRobotLoaded]);

  // Initialize scene, camera, renderer, and controls
  useEffect(() => {
    if (!containerRef.current) return;

    console.log("Initializing 3D scene");

    // Create scene with cyan background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x00b5c7); // Adjusted cyan to match example
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(3, 3, 3);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Create renderer with better settings for full screen
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight
    );

    // Enhanced shadow settings to match example
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;

    // For THREE.js version compatibility
    // @ts-ignore - Encoding settings may vary between THREE.js versions
    if (THREE.sRGBEncoding) {
      // @ts-ignore
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create controls with smoother settings
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI; // Allow full rotation
    controlsRef.current = controls;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    // Main directional light with better shadow settings
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 30, 5);
    directionalLight.castShadow = true;

    // Adjust shadow camera to match example
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;

    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.bias = -0.001; // Reduce shadow acne
    scene.add(directionalLight);

    // Add floor with grid - adjusted position
    const gridSize = 20;
    const gridDivisions = 40; // More dense grid
    const gridHelper = new THREE.GridHelper(
      gridSize,
      gridDivisions,
      0x555555,
      0x999999
    );
    gridHelper.position.y = 0; // Positioned exactly at 0
    scene.add(gridHelper);

    // Add floor plane with shadow material like in the example
    const floorGeometry = new THREE.PlaneGeometry(gridSize, gridSize);
    const floorMaterial = new THREE.ShadowMaterial({
      opacity: 0.25, // Match the example's shadow opacity
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    floor.position.y = 0; // Exactly at the same level as grid
    floor.receiveShadow = true;
    scene.add(floor);

    // Initialize ray for drag controls
    rayRef.current = new THREE.Ray();

    // Create hover material - once and reuse
    hoverMaterialRef.current = new THREE.MeshPhongMaterial({
      emissive: 0xffab40,
      emissiveIntensity: 0.25,
    });

    // Setup animation loop
    const animate = () => {
      if (controlsRef.current) {
        controlsRef.current.update();
      }

      // Update drag controls with mouse position if needed
      if (dragControlsRef.current && rayRef.current) {
        dragControlsRef.current.moveRay(rayRef.current);
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      frameIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current)
        return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      // Skip if dimensions are zero (can happen during some render cycles)
      if (width === 0 || height === 0) return;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();

      rendererRef.current.setSize(width, height);
    };

    // Initial size
    handleResize();

    // Use ResizeObserver for more reliable size detection
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", handleResize);

    // Setup event listeners for manipulate events
    const onManipulateStart = (_e: CustomEvent) => {
      // Save current auto-recenter state
      originalNoAutoRecenterRef.current = true;

      // Disable orbit controls during manipulation
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }

      // Add visual feedback that manipulation has started
      if (containerRef.current) {
        containerRef.current.style.cursor = "grabbing";
      }
    };

    const onManipulateEnd = () => {
      // Restore auto-recenter state

      // Re-enable orbit controls
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }

      // Reset cursor
      if (containerRef.current) {
        containerRef.current.style.cursor = "auto";
      }
    };

    containerRef.current.addEventListener(
      "manipulate-start",
      onManipulateStart as EventListener
    );
    containerRef.current.addEventListener(
      "manipulate-end",
      onManipulateEnd as EventListener
    );

    // Also add hover feedback for better UX
    const onJointMouseOver = () => {
      if (containerRef.current) {
        containerRef.current.style.cursor = "grab";
      }
    };

    const onJointMouseOut = () => {
      if (containerRef.current && !dragControlsRef.current?.manipulating) {
        containerRef.current.style.cursor = "auto";
      }
    };

    containerRef.current.addEventListener(
      "joint-mouseover",
      onJointMouseOver as EventListener
    );
    containerRef.current.addEventListener(
      "joint-mouseout",
      onJointMouseOut as EventListener
    );

    // Cleanup function
    return () => {
      console.log("Cleaning up 3D scene");
      window.removeEventListener("resize", handleResize);

      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      containerRef.current?.removeEventListener(
        "manipulate-start",
        onManipulateStart as EventListener
      );
      containerRef.current?.removeEventListener(
        "manipulate-end",
        onManipulateEnd as EventListener
      );
      containerRef.current?.removeEventListener(
        "joint-mouseover",
        onJointMouseOver as EventListener
      );
      containerRef.current?.removeEventListener(
        "joint-mouseout",
        onJointMouseOut as EventListener
      );

      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }

      cleanupExistingModel();

      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentNode) {
          rendererRef.current.domElement.parentNode.removeChild(
            rendererRef.current.domElement
          );
        }
        rendererRef.current = null;
      }

      // Scene and camera are automatically garbage collected
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Load URDF in a separate effect
  useEffect(() => {
    if (!sceneRef.current || isLoadingRef.current || modelLoadedRef.current)
      return;

    console.log("Loading URDF model");

    // Mark as loading to prevent duplicate loads
    isLoadingRef.current = true;

    // First clean up any existing model
    cleanupExistingModel();

    // Setup loading manager
    const manager = new THREE.LoadingManager();

    manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      console.log(`Loading ${url}: ${itemsLoaded}/${itemsTotal}`);
    };

    manager.onError = (url) => {
      console.error(`Error loading ${url}`);
      setError(`Failed to load ${url}`);
      setLoading(false);
      isLoadingRef.current = false;
    };

    // Create URDF loader
    const loader = new URDFLoader(manager);

    // Setup mesh loading with simple material
    // @ts-expect-error: The types for URDFLoader are incomplete
    loader.loadMeshCb = (
      path: string,
      meshManager: THREE.LoadingManager,
      done: (mesh: THREE.Mesh | null, error?: Error) => void
    ) => {
      const ext = path.split(".").pop()?.toLowerCase();

      if (ext === "stl") {
        const stlLoader = new STLLoader(meshManager);
        stlLoader.load(
          path,
          (geometry: THREE.BufferGeometry) => {
            // Material matching the example
            const material = new THREE.MeshStandardMaterial({
              color: 0x888888,
              metalness: 0.5,
              roughness: 0.3,
              emissive: 0x111111,
              emissiveIntensity: 0.1,
            });

            const mesh = new THREE.Mesh(geometry, material);
            // Ensure shadows are set on the mesh
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            done(mesh);
          },
          undefined,
          (err: unknown) => {
            console.error("Error loading STL:", err);
            done(null, err instanceof Error ? err : new Error(String(err)));
          }
        );
      } else {
        console.warn(`Unsupported file type: ${ext}`);
        done(null, new Error(`Unsupported file type: ${ext}`));
      }
    };

    // Load the robot
    loader.load("./model/arm.urdf", (result) => {
      setLoading(false);
      isLoadingRef.current = false;

      if (result && sceneRef.current) {
        console.log("Robot model loaded successfully");

        // Check for any existing model and clean up first
        cleanupExistingModel();

        // Set up the robot - first cast to unknown to avoid TypeScript errors
        robotRef.current = result as unknown as URDFRobot;
        modelLoadedRef.current = true;

        // Add this to ensure all joints are properly marked
        robotRef.current.traverse((obj: THREE.Object3D) => {
          if (obj.userData && obj.userData.isURDFJoint) {
            // Copy to object directly for compatibility with example code
            (obj as any).isURDFJoint = true;
            (obj as any).jointType = obj.userData.jointType;
          }
        });

        // Make everything cast shadows
        result.traverse((child: THREE.Object3D) => {
          child.castShadow = true;
          child.receiveShadow = true;
        });

        // Add robot to scene
        sceneRef.current.add(result);

        // Center the robot
        const box = new THREE.Box3().setFromObject(result);
        const center = box.getCenter(new THREE.Vector3());

        // Adjust position to match example (centered on floor)
        result.position.x -= center.x;
        // Keep y at zero to place directly on floor
        result.position.z -= center.z;

        // Position camera nicely to match example
        if (cameraRef.current) {
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const distance = maxDim * 2.5;

          // Position camera more from the side like in the example
          cameraRef.current.position.set(
            distance,
            distance * 0.8,
            distance * 0.7
          );
          cameraRef.current.lookAt(new THREE.Vector3(0, size.y / 2, 0));

          // Update the orbit controls target to match
          if (controlsRef.current) {
            controlsRef.current.target.set(0, size.y / 2, 0);
            controlsRef.current.update();
          }
        }

        // Process and set up joint axes based on the URDF file
        result.traverse((obj: THREE.Object3D) => {
          if ((obj as any).isURDFJoint) {
            const joint = obj as URDFJoint;

            // Extract axis from userData if available
            if (joint.userData && joint.userData.axis) {
              const axisData = joint.userData.axis;

              // Create Vector3 from axis data
              const axisVector = new THREE.Vector3(
                parseFloat(axisData.x || 0),
                parseFloat(axisData.y || 0),
                parseFloat(axisData.z || 0)
              );

              // Store the axis on the joint object for use during manipulation
              joint.axis = axisVector.normalize();

              console.log(
                `Joint ${joint.name} has axis: [${axisVector.x}, ${axisVector.y}, ${axisVector.z}]`
              );
            }

            // Extract joint limits from userData if available
            if (joint.userData && joint.userData.limit) {
              const limitData = joint.userData.limit;

              if (
                limitData.lower !== undefined &&
                limitData.upper !== undefined
              ) {
                joint.limit = {
                  lower: parseFloat(limitData.lower),
                  upper: parseFloat(limitData.upper),
                };

                console.log(
                  `Joint ${joint.name} has limits: [${joint.limit.lower}, ${joint.limit.upper}]`
                );
              }
            }
          }
        });

        // Initialize drag controls exactly like in the example
        const dragControls = new URDFDragControls(
          robotRef.current,
          dispatchCustomEvent
        );

        // Set hover callback - exactly matching the example
        dragControls.onHover = (joint) => {
          // Dispatch joint mouseover event
          dispatchCustomEvent("joint-mouseover", joint.name);

          // Apply hover material to all meshes in the joint
          const traverse = (c: THREE.Object3D) => {
            // Skip other joints
            if (c !== joint && (c as any).isURDFJoint) {
              return;
            }

            if (c instanceof THREE.Mesh) {
              // Store original material for restoration
              (c as any).__originalMaterial = c.material;
              c.material = hoverMaterialRef.current!;
            }

            c.children.forEach(traverse);
          };

          traverse(joint);
          setDebugInfo(`Hovering: ${joint.name}`);
        };

        // Set unhover callback - exactly matching the example
        dragControls.onUnhover = (joint) => {
          // Dispatch joint mouseout event
          dispatchCustomEvent("joint-mouseout", joint.name);

          // Restore original materials
          const traverse = (c: THREE.Object3D) => {
            // Skip other joints
            if (c !== joint && (c as any).isURDFJoint) {
              return;
            }

            if (c instanceof THREE.Mesh && (c as any).__originalMaterial) {
              c.material = (c as any).__originalMaterial;
            }

            c.children.forEach(traverse);
          };

          traverse(joint);
          setDebugInfo("");
        };

        dragControlsRef.current = dragControls;

        // Notify parent
        if (onRobotLoaded) {
          onRobotLoaded(robotRef.current);
        }
      }
    });

    return () => {
      // Don't clean up the model when this effect unmounts
      // The model will be cleaned up either when a new one is loaded
      // or when the component unmounts
      isLoadingRef.current = false;
    };
  }, [onRobotLoaded]);

  // Initialize mouse and drag events
  useEffect(() => {
    if (!containerRef.current || !rayRef.current || !cameraRef.current) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;

    const updateRay = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current) return;

      // Calculate mouse position in normalized device coordinates
      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update the raycaster and ray
      raycaster.setFromCamera(mouse, cameraRef.current);
      rayRef.current.copy(raycaster.ray);
    };

    const onMouseMove = (event: MouseEvent) => {
      updateRay(event);

      // Only disable orbit controls while actively manipulating a joint
      if (
        isDragging &&
        dragControlsRef.current &&
        dragControlsRef.current.manipulating
      ) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      updateRay(event);
      isDragging = true;

      if (dragControlsRef.current) {
        dragControlsRef.current.setGrabbed(true);
      }

      // Check if we're now manipulating a joint
      if (dragControlsRef.current && dragControlsRef.current.manipulating) {
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
      }
    };

    const onMouseUp = () => {
      isDragging = false;

      if (dragControlsRef.current) {
        dragControlsRef.current.setGrabbed(false);
      }

      // Re-enable orbit controls
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    };

    // Add event listeners - exactly like in the example
    containerRef.current.addEventListener("mousemove", onMouseMove);
    containerRef.current.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp); // Listen globally

    return () => {
      containerRef.current?.removeEventListener("mousemove", onMouseMove);
      containerRef.current?.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-20">
          <div className="text-white font-bold px-6 py-3 bg-blue-600 rounded-lg shadow-lg">
            Loading robot model...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-800 bg-opacity-50 z-20">
          <div className="text-white font-bold px-6 py-3 bg-red-700 rounded-lg shadow-lg">
            {error}
          </div>
        </div>
      )}
      {!webGLSupported && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-800 bg-opacity-50 z-20">
          <div className="text-white font-bold px-6 py-3 bg-red-700 rounded-lg shadow-lg">
            WebGL not supported - 3D visualization unavailable
          </div>
        </div>
      )}
      {/* Always show debugging info during this troubleshooting */}
      <div className="absolute top-4 left-4 z-20 bg-black bg-opacity-50 text-white p-2 rounded">
        {debugInfo || "Canvas initialized: " + !!rendererRef.current}
      </div>
      <div
        ref={containerRef}
        className="w-full h-full absolute inset-0"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          border: "1px solid red", // Temporary border to debug visibility
        }}
      />
    </div>
  );
};

export default URDFViewer;
