from core.servos import Servos
import time

def calibrate_servos():
    """
    Interactive calibration process for all servos.
    """
    servos = Servos()
    
    try:
        servos.connect()
        servos.start_calibration()
        servo_ids = servos.get_servos()
        

        print(f"Found {len(servo_ids)} servos: {servo_ids}")
        
        # Process one servo at a time
        for servo_id in servo_ids[:1]:
            print(f"\n=== Servo ID {servo_id} ===")
            
            # Zero position
            input(f"Move to ZERO position and press Enter...")
            positions = servos.get_positions()
            zero_pos = positions[servo_id]
            servos.set_calibration_point(servo_id, "zero", zero_pos)
            
            # Minimum position
            input(f"Move to MIN position and press Enter...")
            positions = servos.get_positions()
            min_pos = positions[servo_id]
            servos.set_calibration_point(servo_id, "min", min_pos)
            
            # Maximum position
            input(f"Move to MAX position and press Enter...")
            positions = servos.get_positions()
            max_pos = positions[servo_id]
            servos.set_calibration_point(servo_id, "max", max_pos)
            
        # Confirm before saving
        if input("\nSave calibration? (y/n): ").lower().startswith('y'):
            servos.end_calibration()
        else:
            servos.cancel_calibration()
    
    finally:
        servos.disconnect()

def run_iterative_calibration():
    """
    Run the built-in iterative calibration method from the Servos class.
    """
    servos = Servos()
    
    try:
        servos.connect()
        # Run the built-in calibration process
        servos.iterative_calibration()
    finally:
        # Always disconnect when done
        servos.disconnect()

def test_angle_conversion():
    """
    Thoroughly test the _angle_to_position and _position_to_angle functions for all servos.
    Tests the accuracy and consistency of the angle-to-position conversion system.
    """
    servos = Servos()
    
    try:
        if not servos.is_calibrated:
            print("Servos not calibrated. Please run calibration first.")
            return
            
        print("\n=== Testing Angle to Position Conversion ===")
        servo_ids = servos.get_servos()
        
        # Test angles at various points across the range
        test_angles = [-90, -45, -30, -15, -5, 0, 5, 15, 30, 45, 90]
        
        for servo_id in servo_ids:
            print(f"\nTesting Servo ID {servo_id}")
            print(f"{'Angle':>8} | {'Position':>8} | {'Back to Angle':>12} | {'Error':>8}")
            print("-" * 45)
            
            for angle in test_angles:
                # Convert angle to position
                position = servos._angle_to_position(servo_id, angle)
                
                # Convert position back to angle
                back_angle = servos._position_to_angle(servo_id, position)
                
                # Calculate error
                error = abs(angle - back_angle)
                
                # Print results
                print(f"{angle:8.2f} | {position:8d} | {back_angle:12.2f} | {error:8.2f}")
            
            # Test extreme positions
            zero = servos.calibration[str(servo_id)]['zero']
            min_pos = servos.calibration[str(servo_id)]['min']
            max_pos = servos.calibration[str(servo_id)]['max']
            
            print("\nTesting calibration points:")
            print(f"Zero: {zero} → {servos._position_to_angle(servo_id, zero):.2f}°")
            print(f"Min: {min_pos} → {servos._position_to_angle(servo_id, min_pos):.2f}°")
            print(f"Max: {max_pos} → {servos._position_to_angle(servo_id, max_pos):.2f}°")
    finally:
        servos.disconnect()

if __name__ == "__main__":
    # Choose which calibration method to run
    method = input("Choose calibration method (1: Manual, 2: Iterative, 3: Test Angles): ")
    
    if method == "1":
        print("\nRunning manual calibration...")
        calibrate_servos()
    elif method == "3":
        print("\nRunning angle conversion tests...")
        test_angle_conversion()
    else:
        print("\nRunning iterative calibration...")
        run_iterative_calibration()
