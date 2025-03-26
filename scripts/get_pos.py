import argparse
from core.servos import Servos
import time

def main():
  controller = Servos()
  controller.connect()
  print("getting positions")
  positions = controller.get_positions()  
  print(positions) 
  # controller.set_torque_enabled(False)
  # time.sleep(5)
  # controller.set_torque_enabled(True)
  # time.sleep(5)
  # controller.disconnect()

if __name__ == "__main__":
    main() 