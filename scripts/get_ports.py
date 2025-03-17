#!/usr/bin/env python3
"""
Utility script to find the port connected to a USB device by comparing available ports
before and after connecting the device.
"""

import os
import time
from pathlib import Path
import serial.tools.list_ports


def find_available_ports():
    """Find all available serial ports on the system."""
    if os.name == "nt":  # Windows
        ports = [port.device for port in serial.tools.list_ports.comports()]
    else:  # Linux/macOS
        ports = [str(path) for path in Path("/dev").glob("tty*")]
    return ports


def find_port():
    """
    Interactive function to find the port of a USB device by comparing
    available ports before and after connecting the device.
    """
    print("Please disconnect your USB device if connected.")
    input("Press Enter when device is disconnected...")
    
    ports_before = find_available_ports()
    
    print("Now connect your USB device.")
    input("Press Enter when device is connected...")
    
    time.sleep(0.5)  # Allow some time for port to be detected
    ports_after = find_available_ports()
    
    new_ports = list(set(ports_after) - set(ports_before))
    
    if len(new_ports) == 1:
        port = new_ports[0]
        print(f"Device port found: '{port}'")
        return port
    elif len(new_ports) == 0:
        print("No new ports detected. Try again.")
        return None
    else:
        print(f"Multiple new ports detected: {new_ports}. Please try again.")
        return None


if __name__ == "__main__":
    find_port() 