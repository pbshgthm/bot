#!/usr/bin/env python3
"""
Script to record robot arm movements and save them to a JSON file.

Usage:
    - Run the script to start in recording mode (torque off)
    - Physically move the robot arm to desired positions
    - Press Enter to record each position
    - When done recording, enter 'done' to save to replay.json
"""
import argparse
import time
import json
import os
from servo_controller import ServoController

def main():
    parser = argparse.ArgumentParser(description='Record robot arm movements')
    parser.add_argument('--port', '-p', help='Serial port for the servo controller (overrides config)')
    parser.add_argument('--output', '-o', default='replay.json', help='Output JSON file (default: replay.json)')
    args = parser.parse_args()
    
    try:
        controller = ServoController(port=args.port)
        controller.connect()
        
        record_movements(controller, args.output)
        
    except KeyboardInterrupt:
        print("\nScript terminated by user")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        if 'controller' in locals():
            print("Disconnecting controller...")
            controller.disconnect()

def record_movements(controller, output_file):
    print("\n=== RECORDING MODE ===")
    print("Disabling torque so you can move the arm...")
    controller._write("Torque_Enable", 0)
    time.sleep(0.5)
    
    print("\nMoving to recording mode...")
    print("Instructions:")
    print("1. Physically move the robot arm to desired positions")
    print("2. Press Enter to record each position")
    print("3. Type 'done' when finished recording")
    
    recorded_positions = []
    
    while True:
        user_input = input("\nPosition the arm and press Enter to record (or type 'done'): ")
        
        if user_input.lower() == 'done':
            break
        
        # Get raw servo positions
        raw_positions = controller._read("Present_Position", controller.servo_ids)
        
        # Create dictionary mapping servo names to raw positions
        position_dict = {}
        for name, pos in zip(controller.servo_names, raw_positions):
            position_dict[name] = int(pos)
            
        # Also get angles for display purposes
        angles = controller.get_angles()
        
        recorded_positions.append(position_dict)
        print(f"Position {len(recorded_positions)} recorded:")
        print(f"  Raw positions: {position_dict}")
        print(f"  Angles: {angles}")
    
    if not recorded_positions:
        print("No positions were recorded.")
        return
    
    print(f"\nRecorded {len(recorded_positions)} positions")
    
    # Save to JSON file
    with open(output_file, 'w') as f:
        json.dump(recorded_positions, f, indent=2)
    
    print(f"Saved recording to {output_file}")

if __name__ == "__main__":
    main()
