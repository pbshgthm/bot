import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import URDFLoader from "urdf-loader";

// Core types for URDF objects
interface URDFJoint extends THREE.Object3D {
  isURDFJoint: boolean;
  jointType: string;
  jointValue: any;
  setJointValue: (value: number) => void;
  limit?: { lower: number; upper: number };
  axis?: THREE.Vector3;
}

interface URDFLink extends THREE.Object3D {
  isURDFLink: boolean;
}

interface URDFRobot extends THREE.Object3D {
  joints: { [key: string]: URDFJoint };
  links: { [key: string]: URDFLink };
}

// Simplified drag controls
class URDFDragControls {
  raycaster: THREE.Raycaster;
  robot: URDFRobot | null;
  hovered: URDFJoint | null = null;
  grabbed: boolean = false;
  manipulating: boolean = false;
  hitDistance: number = 0;
  onHover: (joint: URDFJoint) => void;
  onUnhover: (joint: URDFJoint) => void;
  dispatchEvent: (eventName: string, jointName: string) => void;
  startJointValue: number = 0;
  startIntersection: THREE.Vector3 | null = null;
  rotationAxis: THREE.Vector3 | null = null;
  lastValidAngle: number = 0;

  constructor(
    robotGroup: URDFRobot | null,
    dispatchEvent: (eventName: string, jointName: string) => void
  ) {
    this.raycaster = new THREE.Raycaster();
    this.robot = robotGroup;
    this.onHover = () => {};
    this.onUnhover = () => {};
    this.dispatchEvent = dispatchEvent;
  }

  moveRay(ray: THREE.Ray) {
    this.raycaster.ray.copy(ray);
    if (!this.robot) return;

    // Handle joint manipulation when grabbed
    if (this.grabbed && this.hovered) {
      this.manipulating = true;
      const jointWorldPos = new THREE.Vector3();
      this.hovered.getWorldPosition(jointWorldPos);

      if (this.hovered.jointType !== "fixed") {
        // Initialize rotation axis
        if (!this.rotationAxis) {
          if (this.hovered.axis) {
            this.rotationAxis = this.hovered.axis.clone();
            const worldMatrix = new THREE.Matrix4();
            this.hovered.updateWorldMatrix(true, false);
            worldMatrix.extractRotation(this.hovered.matrixWorld);
            this.rotationAxis.applyMatrix4(worldMatrix);
          } else {
            this.rotationAxis = new THREE.Vector3(1, 0, 0);
            const worldMatrix = new THREE.Matrix4();
            this.hovered.updateWorldMatrix(true, false);
            worldMatrix.extractRotation(this.hovered.matrixWorld);
            this.rotationAxis.applyMatrix4(worldMatrix);
          }
          this.rotationAxis.normalize();
        }

        // Handle revolute or continuous joints
        if (
          this.hovered.jointType === "revolute" ||
          this.hovered.jointType === "continuous"
        ) {
          const planeNormal = this.rotationAxis.clone();
          const planePoint = jointWorldPos.clone();
          const planeConstant = -planeNormal.dot(planePoint);
          const rayOriginDotNormal = ray.origin.dot(planeNormal);
          const rayDirectionDotNormal = ray.direction.dot(planeNormal);

          if (Math.abs(rayDirectionDotNormal) > 0.001) {
            const t =
              -(rayOriginDotNormal + planeConstant) / rayDirectionDotNormal;
            if (t > 0) {
              const intersectionPoint = ray.origin
                .clone()
                .add(ray.direction.clone().multiplyScalar(t));

              if (!this.startIntersection) {
                this.startIntersection = intersectionPoint.clone();
                this.startJointValue =
                  typeof this.hovered.jointValue === "number"
                    ? this.hovered.jointValue
                    : this.hovered.jointValue[0];
                return;
              }

              const v1 = this.startIntersection.clone().sub(jointWorldPos);
              const v2 = intersectionPoint.clone().sub(jointWorldPos);

              v1.projectOnPlane(planeNormal).normalize();
              v2.projectOnPlane(planeNormal).normalize();

              if (v1.length() < 0.001 || v2.length() < 0.001) {
                return;
              }

              let angle = Math.acos(Math.min(1, Math.max(-1, v1.dot(v2))));
              const cross = new THREE.Vector3().crossVectors(v1, v2);
              if (cross.dot(planeNormal) < 0) {
                angle = -angle;
              }

              let newValue = this.startJointValue + angle;

              // Apply joint limits
              if (this.hovered.jointType === "revolute" && this.hovered.limit) {
                const { lower, upper } = this.hovered.limit;
                if (newValue < lower) {
                  newValue = lower;
                } else if (newValue > upper) {
                  newValue = upper;
                }
              }

              if (Math.abs(newValue - this.lastValidAngle) > 0.0001) {
                this.hovered.setJointValue(newValue);
                this.lastValidAngle = newValue;
                this.dispatchEvent("angle-change", this.hovered.name);
              }
            }
          }
        }
        // Handle prismatic joints
        else if (this.hovered.jointType === "prismatic") {
          const closestPoint = new THREE.Vector3();
          const line = new THREE.Line3(
            ray.origin,
            ray.origin.clone().add(ray.direction)
          );
          line.closestPointToPoint(jointWorldPos, false, closestPoint);

          if (!this.startIntersection) {
            this.startIntersection = closestPoint.clone();
            this.startJointValue =
              typeof this.hovered.jointValue === "number"
                ? this.hovered.jointValue
                : this.hovered.jointValue[0];
            return;
          }

          const movement = closestPoint.clone().sub(this.startIntersection);
          const distance = movement.dot(this.rotationAxis);
          const scale = 0.01;
          let newValue = this.startJointValue + distance * scale;

          if (this.hovered.limit) {
            const { lower, upper } = this.hovered.limit;
            if (newValue < lower) {
              newValue = lower;
            } else if (newValue > upper) {
              newValue = upper;
            }
          }

          if (Math.abs(newValue - this.lastValidAngle) > 0.0001) {
            this.hovered.setJointValue(newValue);
            this.lastValidAngle = newValue;
            this.dispatchEvent("angle-change", this.hovered.name);
          }
        }
      }
      return;
    }

    // Check for hoverable joints when not manipulating
    if (!this.manipulating) {
      const meshes: THREE.Mesh[] = [];
      this.robot.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          meshes.push(obj);
        }
      });

      const intersects = this.raycaster.intersectObjects(meshes, false);
      let nearestJoint: URDFJoint | null = null;

      if (intersects.length > 0) {
        let current: THREE.Object3D | null = intersects[0].object;
        while (current && current !== this.robot) {
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

      if (nearestJoint !== this.hovered) {
        if (this.hovered) {
          this.onUnhover(this.hovered);
          this.hovered = null;
        }

        if (nearestJoint) {
          this.hovered = nearestJoint;
          this.onHover(nearestJoint);
        }
      }
    }
  }

  setGrabbed(grabbed: boolean) {
    if (grabbed && this.hovered) {
      this.startIntersection = null;
      this.rotationAxis = null;
      this.lastValidAngle =
        typeof this.hovered.jointValue === "number"
          ? this.hovered.jointValue
          : this.hovered.jointValue[0];

      this.grabbed = true;
      this.dispatchEvent("manipulate-start", this.hovered.name);
    } else if (!grabbed) {
      this.grabbed = false;

      if (this.manipulating && this.hovered) {
        this.dispatchEvent("manipulate-end", this.hovered.name);
      }

      this.manipulating = false;
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
  const hoverMaterialRef = useRef<THREE.MeshPhongMaterial | null>(null);
  const [webGLSupported, setWebGLSupported] = useState(true);

  // Clean up existing robot model
  const cleanupExistingModel = () => {
    if (robotRef.current && sceneRef.current) {
      sceneRef.current.remove(robotRef.current);
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
      robotRef.current = null;
      modelLoadedRef.current = false;
    }
  };

  // Custom event dispatcher
  const dispatchCustomEvent = (eventName: string, jointName: string) => {
    if (containerRef.current) {
      const event = new CustomEvent(eventName, { detail: jointName });
      containerRef.current.dispatchEvent(event);
    }
  };

  // Handle angle-change events
  useEffect(() => {
    const handleAngleChange = (e: CustomEvent) => {
      if (!robotRef.current) return;
      if (onRobotLoaded && robotRef.current) {
        onRobotLoaded(robotRef.current);
      }
    };

    containerRef.current?.addEventListener(
      "angle-change",
      handleAngleChange as EventListener
    );

    return () => {
      containerRef.current?.removeEventListener(
        "angle-change",
        handleAngleChange as EventListener
      );
    };
  }, [onRobotLoaded]);

  // Check WebGL support
  useEffect(() => {
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

  // Initialize scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x00b5c7);
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

    // Create renderer
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // For THREE.js version compatibility
    // @ts-ignore
    if (THREE.sRGBEncoding) {
      // @ts-ignore
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 0.5;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI;
    controlsRef.current = controls;

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 30, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.bias = -0.001;
    scene.add(directionalLight);

    // Add grid
    const gridHelper = new THREE.GridHelper(20, 40, 0x555555, 0x999999);
    scene.add(gridHelper);

    // Add floor with shadows
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.ShadowMaterial({
      opacity: 0.25,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Create hover material
    hoverMaterialRef.current = new THREE.MeshPhongMaterial({
      emissive: 0xffab40,
      emissiveIntensity: 0.25,
    });

    // Animation loop
    const animate = () => {
      if (controlsRef.current) {
        controlsRef.current.update();
      }

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

      if (width === 0 || height === 0) return;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    handleResize();

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", handleResize);

    // Event listeners for manipulation
    const onManipulateStart = () => {
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
      if (containerRef.current) {
        containerRef.current.style.cursor = "grabbing";
      }
    };

    const onManipulateEnd = () => {
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      if (containerRef.current) {
        containerRef.current.style.cursor = "auto";
      }
    };

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
      "manipulate-start",
      onManipulateStart as EventListener
    );
    containerRef.current.addEventListener(
      "manipulate-end",
      onManipulateEnd as EventListener
    );
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

      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  // Load URDF model
  useEffect(() => {
    if (!sceneRef.current || isLoadingRef.current || modelLoadedRef.current)
      return;

    isLoadingRef.current = true;
    cleanupExistingModel();

    const manager = new THREE.LoadingManager();

    manager.onError = (url) => {
      setError(`Failed to load ${url}`);
      setLoading(false);
      isLoadingRef.current = false;
    };

    const loader = new URDFLoader(manager);

    // Setup mesh loading
    // @ts-expect-error: Incomplete typings
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
            const material = new THREE.MeshStandardMaterial({
              color: 0x222222,
              metalness: 0.9,
              roughness: 0.2,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            done(mesh);
          },
          undefined,
          (err: unknown) => {
            done(null, err instanceof Error ? err : new Error(String(err)));
          }
        );
      } else {
        done(null, new Error(`Unsupported file type: ${ext}`));
      }
    };

    // Load the robot
    loader.load("./model/arm.urdf", (result) => {
      setLoading(false);
      isLoadingRef.current = false;

      if (result && sceneRef.current) {
        // Clean up and set up new robot
        cleanupExistingModel();
        robotRef.current = result as unknown as URDFRobot;
        modelLoadedRef.current = true;

        // Mark joints properly
        robotRef.current.traverse((obj: THREE.Object3D) => {
          if (obj.userData && obj.userData.isURDFJoint) {
            (obj as any).isURDFJoint = true;
            (obj as any).jointType = obj.userData.jointType;
          }
        });

        // Set shadows
        result.traverse((child: THREE.Object3D) => {
          child.castShadow = true;
          child.receiveShadow = true;
        });

        // Add to scene
        sceneRef.current.add(result);

        // Center the robot
        const box = new THREE.Box3().setFromObject(result);
        const center = box.getCenter(new THREE.Vector3());
        result.position.x -= center.x;
        result.position.z -= center.z;

        // Position camera
        if (cameraRef.current) {
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const distance = maxDim * 2.5;

          cameraRef.current.position.set(
            distance,
            distance * 0.8,
            distance * 0.7
          );
          cameraRef.current.lookAt(new THREE.Vector3(0, size.y / 2, 0));

          if (controlsRef.current) {
            controlsRef.current.target.set(0, size.y / 2, 0);
            controlsRef.current.update();
          }
        }

        // Set up joint properties
        result.traverse((obj: THREE.Object3D) => {
          if ((obj as any).isURDFJoint) {
            const joint = obj as URDFJoint;

            // Set up axis
            if (joint.userData && joint.userData.axis) {
              const axisData = joint.userData.axis;
              const axisVector = new THREE.Vector3(
                parseFloat(axisData.x || 0),
                parseFloat(axisData.y || 0),
                parseFloat(axisData.z || 0)
              );
              joint.axis = axisVector.normalize();
            }

            // Set up limits
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
              }
            }
          }
        });

        // Initialize drag controls
        const dragControls = new URDFDragControls(
          robotRef.current,
          dispatchCustomEvent
        );

        // Set hover callbacks
        dragControls.onHover = (joint) => {
          dispatchCustomEvent("joint-mouseover", joint.name);

          // Apply hover material
          const traverse = (c: THREE.Object3D) => {
            if (c !== joint && (c as any).isURDFJoint) {
              return;
            }

            if (c instanceof THREE.Mesh) {
              (c as any).__originalMaterial = c.material;
              c.material = hoverMaterialRef.current!;
            }

            c.children.forEach(traverse);
          };

          traverse(joint);
        };

        dragControls.onUnhover = (joint) => {
          dispatchCustomEvent("joint-mouseout", joint.name);

          // Restore materials
          const traverse = (c: THREE.Object3D) => {
            if (c !== joint && (c as any).isURDFJoint) {
              return;
            }

            if (c instanceof THREE.Mesh && (c as any).__originalMaterial) {
              c.material = (c as any).__originalMaterial;
            }

            c.children.forEach(traverse);
          };

          traverse(joint);
        };

        dragControlsRef.current = dragControls;

        // Notify parent
        if (onRobotLoaded) {
          onRobotLoaded(robotRef.current);
        }
      }
    });

    return () => {
      isLoadingRef.current = false;
    };
  }, [onRobotLoaded]);

  // Mouse and drag events
  useEffect(() => {
    if (!containerRef.current || !rayRef.current || !cameraRef.current) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let isDragging = false;

    const updateRay = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);
      rayRef.current.copy(raycaster.ray);
    };

    const onMouseMove = (event: MouseEvent) => {
      updateRay(event);

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

      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    };

    containerRef.current.addEventListener("mousemove", onMouseMove);
    containerRef.current.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);

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
        }}
      />
    </div>
  );
};

export default URDFViewer;
