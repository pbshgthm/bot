import time
import traceback
from servo_controller import FeetechController


def wait_for_position(controller, target_pos, tolerance=100, max_wait=3.0, check_interval=0.1):
    start_time = time.time()
    while time.time() - start_time < max_wait:
        positions = controller.get_all_positions()
        all_reached = True
        
        for servo_id, pos in positions.items():
            if abs(pos - target_pos) > tolerance:
                all_reached = False
                break
        
        if all_reached:
            print(f"All servos reached target position {target_pos} (±{tolerance})")
            return True
        
        time.sleep(check_interval)
    
    print(f"Timeout waiting for servos to reach position {target_pos}")
    return False


def bounce(controller, num_cycles=3, min_pos=500, max_pos=3500, delay=0.5):
    print(f"Starting bounce sequence for {len(controller.servo_ids)} servos...")
    
    print("Centering all servos...")
    controller.center_all()
    time.sleep(delay * 2)
    
    for cycle in range(num_cycles):
        print(f"Bounce cycle {cycle+1}/{num_cycles}")
        
        print(f"Moving to max position ({max_pos})...")
        controller.write("Goal_Position", max_pos, controller.servo_ids)
        wait_for_position(controller, max_pos)
        time.sleep(delay)
        
        print(f"Moving to min position ({min_pos})...")
        controller.write("Goal_Position", min_pos, controller.servo_ids)
        wait_for_position(controller, min_pos)
        time.sleep(delay)
    
    print("Returning to center position...")
    controller.center_all()
    wait_for_position(controller, 2048)
    
    print("Bounce sequence completed!")

def bounce_1(controller, num_cycles=3, delay=0.5):
    """
    Bounce only servo with ID 1 between -90 to 90 degrees.
    
    Args:
        controller: FeetechController instance
        num_cycles: Number of bounce cycles to perform
        delay: Delay between movements in seconds
    """
    # Calculate position values for -90 and 90 degrees
    center_pos = 2048
    min_pos = 1024  # -90 degrees
    max_pos = 3072  # 90 degrees
    
    print("Starting bounce sequence for servo ID 1 (-90° to 90°)...")
    
    # Check if servo ID 1 is in the controller's servo_ids
    if 1 not in controller.servo_ids:
        print("Error: Servo ID 1 not found in controller's servo list.")
        return
    
    # Make sure torque is enabled
    try:
        print("Enabling torque on servo 1...")
        controller.enable_torque(1)
        time.sleep(0.5)  # Give time for the command to take effect
    except Exception as e:
        print(f"Warning: Error enabling torque: {e}")
    
    # Center servo 1
    print("Centering servo 1 (0°)...")
    try:
        controller.write("Goal_Position", center_pos, 1)
        print("Center command sent successfully")
    except Exception as e:
        print(f"Error sending center command: {e}")
        return
    
    time.sleep(delay * 2)
    
    # Try to get current position to verify communication
    try:
        current_pos = controller.get_position(1)
        if current_pos is None:
            print("Warning: Unable to read servo position. Communication may be unreliable.")
        else:
            current_degrees = controller.get_position_degrees(1)
            print(f"Current servo position: {current_pos} ({current_degrees:.1f}°)")
    except Exception as e:
        print(f"Error reading position: {e}")
    
    for cycle in range(num_cycles):
        print(f"Bounce cycle {cycle+1}/{num_cycles}")
        
        # Move to 90 degrees
        print(f"Moving to 90° (position {max_pos})...")
        try:
            controller.write("Goal_Position", max_pos, 1)
            print("90° position command sent successfully")
        except Exception as e:
            print(f"Error sending 90° position command: {e}")
            continue
        
        # Wait for servo 1 to reach position
        start_time = time.time()
        position_reached = False
        while time.time() - start_time < 3.0:  # 3 second timeout
            try:
                pos = controller.get_position(1)
                if pos is None:
                    print("Warning: Unable to read position")
                else:
                    degrees = controller.get_position_degrees(1)
                    print(f"\rCurrent position: {pos} ({degrees:.1f}°) | Target: {max_pos} (90°)", end="")
                    if abs(pos - max_pos) <= 100:
                        print(f"\nServo 1 reached target position 90° (±5°)")
                        position_reached = True
                        break
            except Exception as e:
                print(f"\nError reading position: {e}")
            time.sleep(0.1)
        
        if not position_reached:
            print("\nTimeout waiting for servo to reach 90°")
        
        time.sleep(delay)
        
        # Move to -90 degrees
        print(f"Moving to -90° (position {min_pos})...")
        try:
            controller.write("Goal_Position", min_pos, 1)
            print("-90° position command sent successfully")
        except Exception as e:
            print(f"Error sending -90° position command: {e}")
            continue
        
        # Wait for servo 1 to reach position
        start_time = time.time()
        position_reached = False
        while time.time() - start_time < 3.0:  # 3 second timeout
            try:
                pos = controller.get_position(1)
                if pos is None:
                    print("Warning: Unable to read position")
                else:
                    degrees = controller.get_position_degrees(1)
                    print(f"\rCurrent position: {pos} ({degrees:.1f}°) | Target: {min_pos} (-90°)", end="")
                    if abs(pos - min_pos) <= 100:
                        print(f"\nServo 1 reached target position -90° (±5°)")
                        position_reached = True
                        break
            except Exception as e:
                print(f"\nError reading position: {e}")
            time.sleep(0.1)
        
        if not position_reached:
            print("\nTimeout waiting for servo to reach -90°")
        
        time.sleep(delay)
    
    # Return to center position
    print("Returning to center position (0°)...")
    try:
        controller.write("Goal_Position", center_pos, 1)
        print("Center position command sent successfully")
    except Exception as e:
        print(f"Error sending center position command: {e}")
    
    # Wait for servo 1 to reach center position
    start_time = time.time()
    position_reached = False
    while time.time() - start_time < 3.0:  # 3 second timeout
        try:
            pos = controller.get_position(1)
            if pos is None:
                print("Warning: Unable to read position")
            else:
                degrees = controller.get_position_degrees(1)
                print(f"\rCurrent position: {pos} ({degrees:.1f}°) | Target: {center_pos} (0°)", end="")
                if abs(pos - center_pos) <= 100:
                    print(f"\nServo 1 reached center position 0° (±5°)")
                    position_reached = True
                    break
        except Exception as e:
            print(f"\nError reading position: {e}")
        time.sleep(0.1)
    
    if not position_reached:
        print("\nTimeout waiting for servo to reach center position")
    
    print("Bounce sequence completed for servo 1!")

def leader(controller, leader_servo_id=None):
    if leader_servo_id is None:
        leader_servo_id = controller.servo_ids[0]
    
    follower_servo_ids = [id for id in controller.servo_ids if id != leader_servo_id]
    
    if not follower_servo_ids:
        print("No follower servos available. Need at least two servos for leader-follower setup.")
        return
    
    try:
        controller.disable_torque(leader_servo_id)
        print(f"Torque disabled on servo ID {leader_servo_id} (leader)")
        
        controller.enable_torque(follower_servo_ids)
        print(f"Torque enabled on servo IDs {follower_servo_ids} (followers)")
        
        print("\nMonitoring leader servo position. Move it manually and others will follow.")
        print("Press Ctrl+C to stop.")
        
        prev_position = None
        
        while True:
            leader_position = controller.get_position(leader_servo_id)
            
            if prev_position is None or abs(leader_position - prev_position) > 10:
                print(f"\rLeader (ID {leader_servo_id}) position: {leader_position} | " +
                      f"Position in degrees: {controller.get_position_degrees(leader_servo_id):.2f}°", end="")
                
                controller.write("Goal_Position", leader_position, follower_servo_ids)
                
                prev_position = leader_position
            
            time.sleep(0.05)

    except KeyboardInterrupt:
        print("\n\nUser interrupted. Disabling torque on all servos.")
        controller.disable_torque()
    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()


def get_first_servo_position(controller):
    return controller.get_position(controller.servo_ids[0])

if __name__ == "__main__":
    servo_ids = [1]
    port = "/tmp/vport1"
    controller = FeetechController(port, servo_ids, virtual_port=True)
    controller.connect()
    bounce_1(controller)