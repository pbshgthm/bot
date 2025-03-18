#!/usr/bin/env python3
"""
Script to play back recorded robot arm movements from a JSON file.

Usage:
    - Run the script to play back the recorded movements from replay.json
    - Adjust the global variables at the top of the script to change behavior
"""
import time
import json
import numpy as np
from servo_controller import ServoController

# ===== CONFIGURATION (ADJUST THESE VARIABLES) =====
# Input file to load positions from
INPUT_FILE = 'replay.json'

# Speed of servo movement (1-1023, higher is faster)
SPEED = 1200

# Time to wait after reaching each position (seconds)
REST_TIME = 0.5

# Other settings (less commonly adjusted)
TOLERANCE = 30         # Position tolerance for considering a position reached
TIMEOUT = 10.0         # Maximum time to wait for a position to be reached (seconds)
USE_SMOOTH = True      # Use smooth movement between positions
SMOOTH_STEPS = 2      # Number of steps for smooth movement
PORT = None            # Serial port (None to use config.json)
# ===================================================

def main():
    try:
        # Load recorded positions from JSON file
        with open(INPUT_FILE, 'r') as f:
            recorded_positions = json.load(f)
        
        if not recorded_positions:
            print(f"No positions found in {INPUT_FILE}")
            return
            
        print(f"Loaded {len(recorded_positions)} positions from {INPUT_FILE}")
        
        # Connect to the controller
        controller = ServoController(port=PORT)
        controller.connect()
        
        # Play back the recorded positions
        play_back(controller, recorded_positions, SPEED, TOLERANCE, 
                  TIMEOUT, REST_TIME, USE_SMOOTH)
        
    except FileNotFoundError:
        print(f"Error: File '{INPUT_FILE}' not found")
    except json.JSONDecodeError:
        print(f"Error: '{INPUT_FILE}' is not a valid JSON file")
    except KeyboardInterrupt:
        print("\nPlayback stopped by user")
    except Exception as e:
        print(f"\nError: {e}")
    finally:
        if 'controller' in locals():
            print("Disconnecting controller...")
            controller.disconnect()

def position_reached(current, target, tolerance):
    """Check if all servos are within tolerance of their target positions."""
    for name, pos in target.items():
        if name in current:
            if abs(current[name] - pos) > tolerance:
                return False
    return True

def ease_in_out(t):
    """Smooth easing function: slower at the beginning and end, faster in the middle.
    t is a value between 0.0 and 1.0"""
    return 0.5 * (1 - np.cos(t * np.pi))

def smooth_move(controller, start_pos, end_pos, speed, steps=SMOOTH_STEPS):
    """Move smoothly from start position to end position using interpolation."""
    for step in range(1, steps + 1):
        t = step / steps
        t_eased = ease_in_out(t)
        
        # Interpolate position
        interp_pos = {}
        for name in start_pos:
            if name in end_pos:
                start_val = start_pos[name]
                end_val = end_pos[name]
                interp_pos[name] = int(start_val + t_eased * (end_val - start_val))
        
        # Move to intermediate position
        controller.move_to_positions(interp_pos, speed=int(speed * (1 - t_eased/2)))
        
        # Short delay between steps
        time.sleep(0.05)
        
    # Ensure we end at exactly the target position
    controller.move_to_positions(end_pos, speed=speed)

def play_back(controller, positions, speed, tolerance, timeout, rest_time, use_smooth):
    print("\n=== PLAYBACK MODE ===")
    print("Enabling torque for playback...")
    controller._write("Torque_Enable", 1)
    time.sleep(0.5)
    
    # Get initial position
    current_position = controller.get_positions()
    
    # Set initial movement speed
    controller.set_speed(speed)
    print(f"Playing back {len(positions)} positions with a speed of {speed}...")
    print(f"Will wait for each position to be reached (tolerance: {tolerance}, timeout: {timeout}s)")
    
    # Play back each position
    for i, target_position in enumerate(positions):
        print(f"Moving to position {i+1}/{len(positions)}")
        
        # Use smooth movement between positions if enabled
        if use_smooth and i > 0:
            smooth_move(controller, current_position, target_position, speed)
        else:
            # Start movement to target position
            controller.move_to_positions(target_position, speed=speed)
        
        # Wait for position to be reached
        start_time = time.time()
        reached = False
        
        while not reached and (time.time() - start_time < timeout):
            # Get current position
            current_position = controller.get_positions()
            
            # Check if position is reached
            if position_reached(current_position, target_position, tolerance):
                reached = True
                print(f"  Position {i+1} reached")
                
                # Rest after reaching position to stabilize
                if rest_time > 0:
                    print(f"  Resting for {rest_time} seconds...")
                    time.sleep(rest_time)
                break
                
            # Small wait to avoid hammering the servos with read requests
            time.sleep(0.1)
            
        if not reached:
            print(f"  Warning: Timeout reached for position {i+1}, continuing to next position")
            # Update current position anyway
            current_position = controller.get_positions()
    
    print("Playback complete")
    print("Disabling torque...")
    controller._write("Torque_Enable", 0)
    time.sleep(0.5)

if __name__ == "__main__":
    main()