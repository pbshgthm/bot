"""Servo control API server
Uses core.servos to interface with the robot arm hardware
"""
from api.server import main, app

__all__ = ['main', 'app']
