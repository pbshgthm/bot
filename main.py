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

if __name__ == "__main__":
    servo_ids = [1, 2, 3, 4, 5, 6]
    port = "/dev/tty.usbserial-10"
    
    controller = FeetechController(port, servo_ids)
    controller.connect()

    leader(controller, 1)
