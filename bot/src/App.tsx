import { useCallback, useEffect, useRef, useState } from "react";
import RobotControls from "./components/RobotControls";
import URDFViewer from "./components/URDFViewer";

function App() {
  const [robot, setRobot] = useState<any>(null);
  const robotRef = useRef<any>(null);
  // Force re-render when joints change
  const [jointUpdateCounter, setJointUpdateCounter] = useState(0);

  const handleRobotLoaded = useCallback((loadedRobot: any) => {
    // Clear any previous robot reference
    if (robotRef.current && robotRef.current !== loadedRobot) {
      console.log("Replacing previous robot reference");
    }

    // Store reference
    robotRef.current = loadedRobot;
    setRobot(loadedRobot);
    // Force update when robot or its joints change
    setJointUpdateCounter((prev) => prev + 1);

    console.log("Robot loaded and stored in state");
  }, []);

  // Handle joint changes from controls
  const handleJointChange = useCallback((jointName: string, value: number) => {
    if (robotRef.current && robotRef.current.setJointValue) {
      robotRef.current.setJointValue(jointName, value);
    }
  }, []);

  // Ensure component re-renders when joints change
  useEffect(() => {
    if (!robot) return;

    const handleAngleChange = () => {
      // Trigger update when angle changes
      setJointUpdateCounter((prev) => prev + 1);
    };

    // Listen for angle change events
    document.addEventListener("angle-change", handleAngleChange);

    return () => {
      document.removeEventListener("angle-change", handleAngleChange);
    };
  }, [robot]);

  // Force layout recalculation on window resize
  useEffect(() => {
    const handleResize = () => {
      // Force re-render to recalculate layout
      setJointUpdateCounter((prev) => prev + 1);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <div className="w-full h-screen m-0 p-0 overflow-hidden relative">
      {/* 3D Viewer Container */}
      <div className="threejs-container">
        <URDFViewer onRobotLoaded={handleRobotLoaded} />
      </div>

      {/* Controls Container - fixed position */}
      <div className="fixed top-4 right-4 w-80 max-h-[calc(100vh-2rem)] z-50 shadow-xl pointer-events-auto">
        {robot ? (
          <RobotControls
            robot={robot}
            onJointChange={handleJointChange}
            key={`robot-controls-${jointUpdateCounter}`}
          />
        ) : (
          <div className="bg-white/90 rounded-lg p-4 text-gray-800 font-medium">
            Loading robot controls...
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
