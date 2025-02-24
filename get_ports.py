#!/usr/bin/env python3
"""
Utility script to find the port connected to a USB device by comparing available ports
before and after disconnecting the device.

This is a standalone script with no dependencies on other modules.
"""

import os
import time
from pathlib import Path
import serial.tools.list_ports  # Requires pyserial package


def find_available_ports():
    """Find all available serial ports on the system."""
    if os.name == "nt":  # Windows
        # List COM ports using pyserial
        ports = [port.device for port in serial.tools.list_ports.comports()]
    else:  # Linux/macOS
        # List /dev/tty* ports for Unix-based systems
        ports = [str(path) for path in Path("/dev").glob("tty*")]
    return ports


def find_port():
    """
    Interactive function to find the port of a USB device by comparing
    available ports before and after disconnecting the device.
    """
    print("Finding all available ports for the USB device.")
    ports_before = find_available_ports()
    print("Ports before disconnecting:", ports_before)

    print("Remove the USB cable from your device and press Enter when done.")
    input()  # Wait for user to disconnect the device

    time.sleep(0.5)  # Allow some time for port to be released
    ports_after = find_available_ports()
    ports_diff = list(set(ports_before) - set(ports_after))

    if len(ports_diff) == 1:
        port = ports_diff[0]
        print(f"The port of this device is '{port}'")
        print("Reconnect the USB cable.")
        return port
    elif len(ports_diff) == 0:
        print(f"Could not detect the port. No difference was found.")
        return None
    else:
        print(f"Multiple ports were found: {ports_diff}. Please try again.")
        return None


if __name__ == "__main__":
    # Helper to find the USB port associated with your device.
    find_port()
