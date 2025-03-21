#!/usr/bin/env python3
"""
Simplified servo calibration script.
Calibrates each servo at 0°, +90°, and -90° positions sequentially.
"""
import sys
import os
import time
import json

# Add parent directory to path to allow importing the servo_controller module
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from servo_controller import ServoController

def main():
    print("========================================")
    print("         SERVO CALIBRATION TOOL         ")
    print("========================================")
    print("\nThis tool will help you calibrate servo positions.")
    print("You'll be asked to position each servo at 0°, +90°, and -90°")
    
    print("\nINSTRUCTIONS:")
    print("1. Position each servo as prompted")
    print("2. Press Enter after positioning each servo")
    print("3. The tool will show position mapping after each checkpoint")
    
    # Initialize the servo controller
    try:
        controller = ServoController()
        controller._write("Torque_Enable", 0)
        
        # Calibrate each servo in sequence
        for i, name in enumerate(controller.servo_names):
            servo_id = controller.servo_ids[i]
            servo_cal = {}
            
            print(f"\n\n--- Calibrating {name} (ID: {servo_id}) [{i+1}/{len(controller.servo_names)}] ---")
            
            # Position 1: CENTER (0°)
            input(f"\nMove {name} to CENTER position (0°) then press Enter...")
            zero_pos = controller._read("Present_Position", [servo_id])[0]
            servo_cal["zero"] = int(zero_pos)
            print(f"Set {zero_pos} as center (0°)")
            print(f"Position: {zero_pos} → Angle: 0.0°")
            
            # Position 2: MAXIMUM (+90°)
            input(f"\nMove {name} to MAXIMUM POSITIVE (+90°) position then press Enter...")
            pos_90_pos = controller._read("Present_Position", [servo_id])[0]
            servo_cal["max"] = int(pos_90_pos)
            print(f"Set {pos_90_pos} as maximum (+90°)")
            print(f"Position: {pos_90_pos} → Angle: +90.0°")
            
            # Position 3: MINIMUM (-90°)
            input(f"\nMove {name} to MAXIMUM NEGATIVE (-90°) position then press Enter...")
            neg_90_pos = controller._read("Present_Position", [servo_id])[0]
            servo_cal["min"] = int(neg_90_pos)
            print(f"Set {neg_90_pos} as minimum (-90°)")
            print(f"Position: {neg_90_pos} → Angle: -90.0°")
            
            # Save calibration for this servo
            controller.calibration[str(servo_id)] = servo_cal
            
            # Determine if servo is in normal or inverted configuration
            is_inverted = (pos_90_pos < zero_pos) == (neg_90_pos < zero_pos)
            direction = "INVERTED" if is_inverted else "NORMAL"
            
            print(f"\nCalibration summary for {name}:")
            print(f"Configuration: {direction}")
            print(f"Position mapping:")
            print(f"  -90° = {neg_90_pos}")
            print(f"   0°  = {zero_pos}")
            print(f"  +90° = {pos_90_pos}")
            
            if pos_90_pos > neg_90_pos:
                print(f"Direction: Increasing position = Increasing angle")
            else:
                print(f"Direction: Increasing position = Decreasing angle")
            
            print(f"Movement range: {abs(pos_90_pos - neg_90_pos)} units")
            
            # Test a few conversions
            test_positions = [
                neg_90_pos,                                         # -90° position
                int(zero_pos + (neg_90_pos - zero_pos) * 0.5),      # -45° position
                zero_pos,                                           # 0° position
                int(zero_pos + (pos_90_pos - zero_pos) * 0.5),      # +45° position
                pos_90_pos                                          # +90° position
            ]
            
            print("\nTesting position-to-angle mapping:")
            for pos in test_positions:
                angle = controller._position_to_angle(pos, servo_id)
                expected = "N/A"
                if pos == neg_90_pos:
                    expected = "-90.0°"
                elif pos == zero_pos:
                    expected = "0.0°"
                elif pos == pos_90_pos:
                    expected = "+90.0°"
                print(f"  Position: {pos:4d} → Angle: {angle:+.1f}° (Expected: {expected})")
            
            print("\nTesting angle-to-position mapping:")
            for ang in [-90, -45, 0, 45, 90]:
                pos = controller._angle_to_position(ang, servo_id)
                back_angle = controller._position_to_angle(pos, servo_id)
                print(f"  Angle: {ang:+3d}° → Position: {pos:4d} → Back to angle: {back_angle:+.1f}°")
            
            # Save after each servo calibration
            controller.calibration["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            try:
                with open(controller.calibration_file, 'w') as f:
                    json.dump(controller.calibration, f, indent=2)
                print(f"\nSaved calibration to {controller.calibration_file}")
            except Exception as e:
                print(f"Error saving calibration: {e}")
            
            if i < len(controller.servo_names) - 1:
                input("\nPress Enter to continue to next servo...")
        
        print("\nCalibration complete for all servos!")
        print("You can now use the servos with accurate angle control.")
        
    except KeyboardInterrupt:
        print("\nCalibration interrupted.")
    except Exception as e:
        print(f"\nError during calibration: {e}")
    finally:
        # Ensure servos are disabled after calibration
        if 'controller' in locals() and controller._is_connected:
            controller._write("Torque_Enable", 0)
            controller.disconnect()

if __name__ == "__main__":
    main() 