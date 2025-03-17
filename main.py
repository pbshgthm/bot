import time
from servo_controller import ServoController

def get_pos(controller):
    print("Current positions:")
    angles = controller.get_angles()
    for name, angle in angles.items():
        print(f"{name}: {angle:.1f}°")
    return angles

if __name__ == "__main__":
    servos = {
        "base-yaw": 1, 
    }
    port = '/dev/tty.usbmodem58FA0829321'
    
    controller = ServoController(port, servos)

    controller.connect()
    # controller.calibrate()    
    controller.move({"base-yaw": 90})
    time.sleep(2)
    controller.move({"base-yaw": 0})
    time.sleep(2)
    controller.move({"base-yaw": -90})
    time.sleep(2)
    controller.move({"base-yaw": 0})
    controller.disconnect()