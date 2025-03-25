import { memo, useCallback } from "react";

interface JointControl {
  name: string;
  value: number;
  min: number;
  max: number;
  type: string;
  id: string;
}

interface RobotControlsProps {
  jointAngles: Record<string, number>;
  onAngleChange: (jointName: string, angle: number) => void;
  onDragEnd?: () => void;
  torqueEnabled: boolean;
  onTorqueToggle: () => Promise<void>;
  onStartCalibration: () => Promise<void>;
  isCalibrating: boolean;
}

// Joint slider component with minimalist design
const JointSlider = memo(
  ({
    joint,
    onChange,
    onDragEnd,
    torqueEnabled = true,
  }: {
    joint: JointControl;
    onChange: (joint: JointControl, value: number) => void;
    onDragEnd?: () => void;
    torqueEnabled?: boolean;
  }) => {
    // Only show for adjustable joints
    if (
      joint.type !== "revolute" &&
      joint.type !== "continuous" &&
      joint.type !== "prismatic"
    ) {
      return null;
    }

    // Calculate min, center, and max values in degrees
    const minDeg = (joint.min * 180) / Math.PI;
    const maxDeg = (joint.max * 180) / Math.PI;
    const centerDeg = (minDeg + maxDeg) / 2;

    // Format display values (shortening if needed)
    const formatDeg = (deg: number) => {
      const rounded = Math.round(deg * 10) / 10;
      return rounded === 0 ? "0°" : `${rounded}°`;
    };

    return (
      <li key={joint.id} className="mb-2.5">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center">
            <span
              className="font-medium text-xs text-gray-700 truncate"
              title={joint.name}
            >
              {joint.name}
            </span>
            {!torqueEnabled && (
              <span
                className="ml-1 inline-flex items-center text-red-500"
                title="Read-only: Torque disabled"
              >
                <svg
                  className="w-2.5 h-2.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  ></path>
                </svg>
              </span>
            )}
          </div>
          <span className="text-xs text-gray-500 font-mono">
            {((joint.value * 180) / Math.PI).toFixed(1)}°
          </span>
        </div>

        <div className="relative pb-2.5">
          {/* Slider track with custom styling */}
          <input
            type="range"
            min={minDeg}
            max={maxDeg}
            step="0.1"
            value={(joint.value * 180) / Math.PI}
            onChange={(e) =>
              torqueEnabled && onChange(joint, parseFloat(e.target.value))
            }
            onMouseUp={() => torqueEnabled && onDragEnd?.()}
            onTouchEnd={() => torqueEnabled && onDragEnd?.()}
            onMouseLeave={(e) => {
              // Only trigger dragEnd if the primary button is still pressed
              if (e.buttons === 1 && torqueEnabled) onDragEnd?.();
            }}
            className={`w-full h-1 appearance-none bg-gray-200 rounded-full outline-none ${
              torqueEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-70"
            } slider-input`}
            style={{
              WebkitAppearance: "none",
            }}
            disabled={!torqueEnabled}
          />

          {/* Tick marks with clickable areas - showing min, center, max */}
          <div className="absolute bottom-0 left-0 w-full flex justify-between px-0.5">
            {/* Min tick */}
            <div
              className={`flex flex-col items-center ${
                torqueEnabled
                  ? "cursor-pointer group"
                  : "cursor-not-allowed opacity-70"
              }`}
              onClick={() => torqueEnabled && onChange(joint, minDeg)}
              style={{ width: "16px" }}
            >
              <div className="h-1 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span
                className="text-[7px] text-gray-400 group-hover:text-gray-600 truncate"
                style={{ maxWidth: "24px" }}
              >
                {formatDeg(minDeg)}
              </span>
            </div>

            {/* Center tick */}
            <div
              className={`flex flex-col items-center ${
                torqueEnabled
                  ? "cursor-pointer group"
                  : "cursor-not-allowed opacity-70"
              }`}
              onClick={() => torqueEnabled && onChange(joint, centerDeg)}
              style={{ width: "16px" }}
            >
              <div className="h-1 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span className="text-[7px] text-gray-400 group-hover:text-gray-600">
                {formatDeg(centerDeg)}
              </span>
            </div>

            {/* Max tick */}
            <div
              className={`flex flex-col items-center ${
                torqueEnabled
                  ? "cursor-pointer group"
                  : "cursor-not-allowed opacity-70"
              }`}
              onClick={() => torqueEnabled && onChange(joint, maxDeg)}
              style={{ width: "16px" }}
            >
              <div className="h-1 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span
                className="text-[7px] text-gray-400 group-hover:text-gray-600 truncate"
                style={{ maxWidth: "24px" }}
              >
                {formatDeg(maxDeg)}
              </span>
            </div>
          </div>
        </div>
      </li>
    );
  }
);

// Add custom styling for the range input thumb
const styleTag = document.createElement("style");
styleTag.textContent = `
  .slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: #4b5563;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  
  .slider-input::-moz-range-thumb {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: #4b5563;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
  
  .slider-input:disabled::-webkit-slider-thumb {
    background: #9ca3af;
    cursor: not-allowed;
  }
  
  .slider-input:disabled::-moz-range-thumb {
    background: #9ca3af;
    cursor: not-allowed;
  }
  
  .slider-input:disabled {
    opacity: 0.7;
  }
`;
document.head.appendChild(styleTag);

// Define joint limits based on URDF model
const JOINT_LIMITS: Record<string, { min: number; max: number; type: string }> =
  {
    "1-servo_1-yaw": { min: -Math.PI / 2, max: Math.PI / 2, type: "revolute" },
    "2-servo_2-pitch": {
      min: -Math.PI / 2,
      max: Math.PI / 2,
      type: "revolute",
    },
    "3-servo_3-pitch": {
      min: -Math.PI / 2,
      max: Math.PI / 2,
      type: "revolute",
    },
    "4-servo_4-pitch": {
      min: -Math.PI / 2,
      max: Math.PI / 2,
      type: "revolute",
    },
    "5-servo_5-roll": { min: -Math.PI / 2, max: Math.PI / 2, type: "revolute" },
    "6-servo_6-grip": {
      min: -Math.PI / 2,
      max: Math.PI / 2,
      type: "prismatic",
    },
  };

// Friendly names for the joints
const JOINT_NAMES: Record<string, string> = {
  "1-servo_1-yaw": "Base",
  "2-servo_2-pitch": "Shoulder",
  "3-servo_3-pitch": "Elbow",
  "4-servo_4-pitch": "Wrist Pitch",
  "5-servo_5-roll": "Wrist Roll",
  "6-servo_6-grip": "Gripper",
};

const RobotControls = ({
  jointAngles,
  onAngleChange,
  onDragEnd,
  torqueEnabled,
  onTorqueToggle,
  onStartCalibration,
  isCalibrating,
}: RobotControlsProps) => {
  // Convert joint angles to JointControl objects
  const jointControls = Object.keys(JOINT_LIMITS).map((jointName) => {
    const limits = JOINT_LIMITS[jointName];
    const value = jointAngles[jointName] || 0;
    // Convert degrees to radians for the control
    const valueInRadians = (value * Math.PI) / 180;

    return {
      name: JOINT_NAMES[jointName] || jointName,
      value: valueInRadians,
      min: limits.min,
      max: limits.max,
      type: limits.type,
      id: jointName,
    };
  });

  // Handle joint slider change
  const handleJointChange = useCallback(
    (joint: JointControl, valueDeg: number) => {
      // Convert value to radians for the 3D model
      onAngleChange(joint.id, valueDeg);
    },
    [onAngleChange]
  );

  return (
    <div className="bg-white/90 backdrop-blur rounded-lg p-3 overflow-y-auto max-h-full shadow-md">
      {/* Header with controls */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
        <div className="flex items-center">
          {!isCalibrating && (
            <div className="flex items-center">
              <span className="text-xs font-medium text-gray-600 mr-2">
                Torque
              </span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={torqueEnabled}
                  onChange={onTorqueToggle}
                  className="sr-only peer"
                  disabled={isCalibrating}
                />
                <div
                  className={`w-7 h-4 rounded-full peer peer-focus:ring-1 peer-focus:ring-offset-1 
                    ${
                      torqueEnabled
                        ? "bg-green-400 peer-focus:ring-green-300"
                        : "bg-red-400 peer-focus:ring-red-300"
                    } 
                    after:content-[''] after:absolute after:top-0.5 after:left-[2px] 
                    after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 
                    after:transition-all ${
                      torqueEnabled ? "after:translate-x-3" : ""
                    }`}
                ></div>
              </label>
            </div>
          )}
          {isCalibrating && (
            <span className="text-xs font-medium text-gray-600">
              Calibrating...
            </span>
          )}
        </div>
        <div>
          {!isCalibrating ? (
            <button
              onClick={() => onStartCalibration()}
              className="bg-gray-400 hover:bg-gray-500 text-white px-2 py-0.5 rounded text-xs transition-colors"
            >
              Calibrate
            </button>
          ) : (
            <button
              disabled
              className="bg-gray-300 cursor-not-allowed text-white px-2 py-0.5 rounded text-xs"
            >
              Calibrating...
            </button>
          )}
        </div>
      </div>

      {isCalibrating && (
        <div className="text-center py-2 text-gray-500 text-xs font-medium">
          Calibration in progress
        </div>
      )}

      <ul className="flex flex-col space-y-0.5">
        {jointControls.map((joint) => (
          <JointSlider
            key={joint.id}
            joint={joint}
            onChange={handleJointChange}
            onDragEnd={onDragEnd}
            torqueEnabled={torqueEnabled && !isCalibrating}
          />
        ))}
      </ul>
    </div>
  );
};

export default RobotControls;
