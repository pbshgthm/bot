import React, { memo, useCallback, useEffect, useState } from "react";

interface JointControl {
  name: string;
  value: number;
  min: number;
  max: number;
  type: string;
}

interface RobotControlsProps {
  robot: any; // Using 'any' here since the URDF robot type is not well defined in TypeScript
  onJointChange?: (jointName: string, value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  jointValues?: Record<string, number>;
  isCalibrating?: boolean;
  torqueEnabled?: boolean;
}

// Joint slider component with minimalist design
const JointSlider = memo(
  ({
    joint,
    onChange,
    onDragStart,
    onDragEnd,
    torqueEnabled = true,
  }: {
    joint: JointControl;
    onChange: (joint: JointControl, value: number) => void;
    onDragStart?: () => void;
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
      <li key={joint.name} className="mb-3">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center">
            <span
              className="font-medium text-xs text-gray-900 truncate"
              title={joint.name}
            >
              {joint.name}
            </span>
            {!torqueEnabled && (
              <span
                className="ml-1.5 inline-flex items-center text-red-500"
                title="Read-only: Torque disabled"
              >
                <svg
                  className="w-3 h-3"
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
          <span className="text-xs text-gray-600 font-mono">
            {((joint.value * 180) / Math.PI).toFixed(1)}°
          </span>
        </div>

        <div className="relative pb-3">
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
            onMouseDown={() => torqueEnabled && onDragStart?.()}
            onTouchStart={() => torqueEnabled && onDragStart?.()}
            onMouseUp={() => torqueEnabled && onDragEnd?.()}
            onTouchEnd={() => torqueEnabled && onDragEnd?.()}
            onMouseLeave={(e) => {
              // Only trigger dragEnd if the primary button is still pressed
              if (e.buttons === 1 && torqueEnabled) onDragEnd?.();
            }}
            className={`w-full h-1.5 appearance-none bg-gray-200 rounded-full outline-none ${
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
              style={{ width: "20px" }}
            >
              <div className="h-1.5 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span
                className="text-[8px] text-gray-400 group-hover:text-gray-600 truncate"
                style={{ maxWidth: "30px" }}
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
              style={{ width: "20px" }}
            >
              <div className="h-1.5 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span className="text-[8px] text-gray-400 group-hover:text-gray-600">
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
              style={{ width: "20px" }}
            >
              <div className="h-1.5 w-px bg-gray-300 group-hover:bg-gray-500 transition-colors" />
              <span
                className="text-[8px] text-gray-400 group-hover:text-gray-600 truncate"
                style={{ maxWidth: "30px" }}
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

JointSlider.displayName = "JointSlider";

// Add custom styling for the range input thumb - making it smaller for compact layout
const globalStyles = `
  .slider-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    background: #4b5563;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  
  .slider-input::-moz-range-thumb {
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    background: #4b5563;
    cursor: pointer;
    border: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
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

const RobotControls = ({
  robot,
  onJointChange,
  onDragStart,
  onDragEnd,
  jointValues = {},
  isCalibrating,
  torqueEnabled = true,
}: RobotControlsProps) => {
  const [joints, setJoints] = useState<JointControl[]>([]);

  // Initial setup of joints from robot
  useEffect(() => {
    if (!robot || !robot.joints) return;

    // Create joint controls from robot joints
    const jointControls = Object.keys(robot.joints)
      .sort((a, b) => {
        const da = a
          .split(/[^\d]+/g)
          .filter((v) => !!v)
          .pop();
        const db = b
          .split(/[^\d]+/g)
          .filter((v) => !!v)
          .pop();

        if (da !== undefined && db !== undefined) {
          const delta = parseFloat(da) - parseFloat(db);
          if (delta !== 0) return delta;
        }

        if (a > b) return 1;
        if (b > a) return -1;
        return 0;
      })
      .map((key) => {
        const joint = robot.joints[key];
        const value =
          jointValues[key] !== undefined ? jointValues[key] : joint.angle || 0;
        return {
          name: joint.name,
          value,
          min: joint.limit ? joint.limit.lower : -3.14,
          max: joint.limit ? joint.limit.upper : 3.14,
          type: joint.jointType,
        };
      });

    setJoints(jointControls);
  }, [robot, jointValues]);

  // Update joints when external jointValues change
  useEffect(() => {
    if (
      !robot ||
      !robot.joints ||
      joints.length === 0 ||
      Object.keys(jointValues).length === 0
    )
      return;

    // Update joint values from props
    const updatedJoints = joints.map((joint) => {
      const newValue = jointValues[joint.name];
      if (newValue !== undefined && Math.abs(newValue - joint.value) > 0.001) {
        return { ...joint, value: newValue };
      }
      return joint;
    });

    setJoints(updatedJoints);
  }, [jointValues, robot]);

  const handleSliderChange = useCallback(
    (joint: JointControl, value: number) => {
      if (!robot || !robot.joints) return;

      // Update the joint value - always convert from degrees to radians
      const actualValue = (value * Math.PI) / 180;

      if (robot.setJointValue) {
        robot.setJointValue(joint.name, actualValue);
      }

      if (onJointChange) {
        onJointChange(joint.name, actualValue);
      }

      // Update the joint in our state
      setJoints((prevJoints) =>
        prevJoints.map((j) =>
          j.name === joint.name ? { ...j, value: actualValue } : j
        )
      );
    },
    [robot, onJointChange]
  );

  if (!robot || !robot.joints || joints.length === 0) {
    return <div className="p-4 text-center">No robot joints available</div>;
  }

  return (
    <div className="bg-white/95 backdrop-blur rounded-lg p-4 overflow-y-auto max-h-full shadow-md">
      <style>{globalStyles}</style>
      <h2 className="text-sm font-bold mb-3 text-gray-900 border-b pb-2">
        Robot Controls
      </h2>

      {isCalibrating ? (
        <div className="text-center p-4 text-orange-600 font-medium">
          Calibration in progress. Sliders disabled.
        </div>
      ) : !torqueEnabled ? (
        <div className="text-center p-2 mb-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center justify-center mb-1">
            <svg
              className="w-4 h-4 text-red-500 mr-1.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              ></path>
            </svg>
            <span className="text-red-600 font-medium">Torque Disabled</span>
          </div>
          <p className="text-xs text-red-600">
            Sliders are in read-only mode. Enable torque to control the robot.
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col space-y-1">
        {joints
          .filter((joint) => joint.type !== "fixed")
          .map((joint) => (
            <JointSlider
              key={joint.name}
              joint={joint}
              onChange={handleSliderChange}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              torqueEnabled={torqueEnabled}
            />
          ))}
      </ul>
    </div>
  );
};

export default memo(RobotControls);
