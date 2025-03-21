import time
import numpy as np
import scservo_sdk as scs
import json
import os
import datetime

PROTOCOL_VERSION = 0
BAUDRATE = 1_000_000
TIMEOUT_MS = 1000
NUM_RETRY = 10

# Global configuration parameters
P_COEFFICIENT = 8
I_COEFFICIENT = 0
D_COEFFICIENT = 16
MAX_ACCELERATION = 254
ACCELERATION = 254

SCS_CONTROL_TABLE = {
    "Torque_Enable": (40, 1),
    "Goal_Position": (42, 2),
    "Present_Position": (56, 2),
    "Mode": (33, 1),
    "P_Coefficient": (21, 1),
    "I_Coefficient": (23, 1),
    "D_Coefficient": (22, 1),
    "Lock": (55, 1),
    "Maximum_Acceleration": (85, 2),
    "Acceleration": (41, 1),
}

CENTER_POSITION = 2048
MODEL_RESOLUTION = 4096

class ServoController:
    def __init__(self, port=None, servos=None):
        # Load config file
        self.config_file = os.path.join(os.path.dirname(__file__), "config.json")
        self.config = self._load_config()
        
        # Use provided parameters or config values
        self.port = port or self.config.get('port')
        self.servos = servos or self.config.get('servos', {})
        
        if not self.port:
            raise ValueError("No port specified and no port found in config.json")
        
        if not self.servos:
            raise ValueError("No servos specified and no servos found in config.json")
        
        self.servo_names = list(self.servos.keys())
        self.servo_ids = list(self.servos.values())
        
        self._is_connected = False
        self._readers = {}
        self._writers = {}
        
        self.calibration = {}
        self.calibration_file = os.path.join(os.path.dirname(__file__), "servo_calibration.json")
        
        if os.path.exists(self.calibration_file):
            try:
                with open(self.calibration_file, 'r') as f:
                    self.calibration = json.load(f)
                print(f"Loaded calibration from {self.calibration_file}")
            except Exception as e:
                print(f"Error loading calibration: {e}")
                
        # Automatically connect and configure servos
        self.connect()
        self.configure_servos()
    
    def _load_config(self):
        """Load configuration from config.json file."""
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                print(f"Loaded configuration from {self.config_file}")
                return config
            else:
                print(f"Config file not found: {self.config_file}")
                return {}
        except Exception as e:
            print(f"Error loading config: {e}")
            return {}

    def connect(self):
        if self._is_connected:
            print("Already connected, skipping connection")
            return
            
        self.port_handler = scs.PortHandler(self.port)
        self.packet_handler = scs.PacketHandler(PROTOCOL_VERSION)

        try:
            if not self.port_handler.openPort():
                raise OSError(f"Failed to open port '{self.port}'")
            
            self.port_handler.setBaudRate(BAUDRATE)
            self.port_handler.setPacketTimeoutMillis(TIMEOUT_MS)
            self._is_connected = True
            print(f"Connected on port={self.port}")
        
        except Exception as e:
            if hasattr(self, 'port_handler') and self.port_handler:
                self.port_handler.closePort()
            raise e

    def disconnect(self):
        if not self._is_connected:
            return
        
        self._write("Torque_Enable", 0)
        time.sleep(0.1)
            
        if hasattr(self, 'port_handler') and self.port_handler:
            self.port_handler.closePort()
            
        self._readers = {}
        self._writers = {}
        self._is_connected = False
        print("Disconnected")

    def calibrate(self):
        if not self._is_connected:
            self.connect()
            
        self._write("Torque_Enable", 0)
        
        for name, servo_id in self.servos.items():
            servo_cal = {}
            
            print(f"\n--- Calibrating {name} (ID: {servo_id}) ---")
            print("Important: Move the servo to each position when prompted.")
            print("Monitor the position and angle values to understand the mapping.")
            
            input(f"Move servo to CENTER position (0°) and press Enter...")
            zero_pos = self._read("Present_Position", [servo_id])[0]
            servo_cal["zero"] = int(zero_pos)
            print(f"Set {zero_pos} as center (0°)")
            
            input(f"Move servo to MAXIMUM POSITIVE (+90°) position and press Enter...")
            pos_90_pos = self._read("Present_Position", [servo_id])[0]
            servo_cal["max"] = int(pos_90_pos)
            print(f"Set {pos_90_pos} as maximum (+90°)")
            
            input(f"Move servo to MAXIMUM NEGATIVE (-90°) position and press Enter...")
            neg_90_pos = self._read("Present_Position", [servo_id])[0]
            servo_cal["min"] = int(neg_90_pos)
            print(f"Set {neg_90_pos} as minimum (-90°)")
            
            # Determine if servo is in normal or inverted configuration
            is_inverted = (pos_90_pos < zero_pos) == (neg_90_pos < zero_pos)
            direction = "INVERTED" if is_inverted else "NORMAL"
            
            print(f"\nCalibration complete for {name}")
            print(f"Configuration: {direction}")
            print(f"Position mapping:")
            print(f"  -90° = {neg_90_pos}")
            print(f"   0°  = {zero_pos}")
            print(f"  +90° = {pos_90_pos}")
            
            if pos_90_pos > neg_90_pos:
                print(f"Direction: Increasing position = Increasing angle")
            else:
                print(f"Direction: Increasing position = Decreasing angle")
            
            print(f"Movement range: {abs(pos_90_pos - neg_90_pos)} units")
            
            self.calibration[str(servo_id)] = servo_cal
            
            input(f"Press Enter to continue to next servo (or Ctrl+C to stop)...")
        
        self.calibration["timestamp"] = datetime.datetime.now().isoformat()
        try:
            with open(self.calibration_file, 'w') as f:
                json.dump(self.calibration, f, indent=2)
            print(f"Saved calibration to {self.calibration_file}")
        except Exception as e:
            print(f"Error saving calibration: {e}")
            
        print("Calibration complete for all servos")
        print("You can now re-enable torque and use the servos")

    def get_positions(self):
        """Get the current raw positions of all servos."""
        positions = self._read("Present_Position", self.servo_ids)
        return {name: int(pos) for name, pos in zip(self.servo_names, positions)}

    def get_angles(self):
        """Get the current angles of all servos."""
        positions = self._read("Present_Position", self.servo_ids)
        return {name: self._position_to_angle(pos, self.servos[name]) 
                for name, pos in zip(self.servo_names, positions)}

    def configure_servos(self):
        """Configure servo parameters using global configuration values."""
        if not self._is_connected:
            self.connect()
            
        # Enable torque first to ensure servos are active
        self._write("Torque_Enable", 1)
        
        for servo_id in self.servo_ids:
            # Set to Position Control mode
            self._write("Mode", 0, servo_id)
            
            # Set PID coefficients from global variables
            self._write("P_Coefficient", P_COEFFICIENT, servo_id)
            self._write("I_Coefficient", I_COEFFICIENT, servo_id)
            self._write("D_Coefficient", D_COEFFICIENT, servo_id)
            
            # Disable the write lock to allow writing to EEPROM
            self._write("Lock", 0, servo_id)
            
            # Set acceleration parameters from global variables
            self._write("Maximum_Acceleration", MAX_ACCELERATION, servo_id)
            self._write("Acceleration", ACCELERATION, servo_id)
            
        print(f"Servos configured with P={P_COEFFICIENT}, I={I_COEFFICIENT}, D={D_COEFFICIENT}, Maximum Acceleration={MAX_ACCELERATION}, Acceleration={ACCELERATION}")

    def move(self, angles):
        """
        Move servos to specified angles.
        
        While the UI is limited to ±90°, internally we allow values beyond
        this range to ensure proper scaling and continuous motion.
        
        Args:
            angles: Dictionary mapping servo names to angle values
        """
        positions = []
        servo_ids = []
        
        for name, angle in angles.items():
            if name not in self.servos:
                raise ValueError(f"Unknown servo: {name}")
                
            # No angle limit enforcement - allow values beyond ±90° internally
            # for proper scaling. The UI should enforce its own limits.
            servo_id = self.servos[name]
            position = self._angle_to_position(angle, servo_id)
            positions.append(position)
            servo_ids.append(servo_id)
            
            # Log if angle is outside normal range
            if abs(angle) > 90:
                print(f"Warning: {name} angle {angle}° is outside standard ±90° range")
        
        if positions:
            self._write("Goal_Position", positions, servo_ids)

    def move_to_positions(self, positions):
        """Move servos directly to specified raw positions."""
        pos_values = []
        servo_ids = []
        
        for name, position in positions.items():
            if name not in self.servos:
                raise ValueError(f"Unknown servo: {name}")
                
            servo_id = self.servos[name]
            pos_values.append(int(position))
            servo_ids.append(servo_id)
        
        if pos_values:
            self._write("Goal_Position", pos_values, servo_ids)

    def center(self):
        """Move all servos to their center (0°) position."""
        self.move({name: 0 for name in self.servo_names})

    def _angle_to_position(self, angle, servo_id):
        """
        Convert UI angle to servo position value using pure linear mapping.
        
        This method ensures a consistent linear relationship between angles and positions,
        properly handling both normal and inverted servo configurations.
        
        Args:
            angle: The angle in degrees (-90 to +90 from UI, but can be beyond that range internally)
            servo_id: The ID of the servo
            
        Returns:
            The calculated position value
        """
        str_id = str(servo_id)
        
        # If no calibration exists, use default mapping
        if str_id not in self.calibration:
            return int(CENTER_POSITION + (angle * MODEL_RESOLUTION / 360))
            
        cal = self.calibration[str_id]
        zero_pos = cal["zero"]
        pos_90_pos = cal["max"]
        neg_90_pos = cal["min"]
        
        # Simple linear interpolation between calibration points
        if angle == 0:
            return zero_pos
        elif angle > 0:
            # Map positive angles to positions between zero_pos and pos_90_pos
            return int(zero_pos + (angle / 90) * (pos_90_pos - zero_pos))
        else:
            # Map negative angles to positions between zero_pos and neg_90_pos
            return int(zero_pos + (angle / -90) * (neg_90_pos - zero_pos))

    def _position_to_angle(self, position, servo_id):
        """
        Convert servo position value to angle using pure linear mapping.
        
        This method correctly maps positions back to angles,
        handling both normal and inverted servo configurations.
        
        Args:
            position: The raw position value from the servo
            servo_id: The ID of the servo
            
        Returns:
            The calculated angle in degrees
        """
        str_id = str(servo_id)
        
        # If no calibration exists, use default mapping
        if str_id not in self.calibration:
            return (position - CENTER_POSITION) * 360 / MODEL_RESOLUTION
            
        cal = self.calibration[str_id]
        zero_pos = cal["zero"]
        pos_90_pos = cal["max"]
        neg_90_pos = cal["min"]
        
        # Handle position exactly at zero
        if position == zero_pos:
            return 0.0
            
        # For positions on the positive side (between zero and +90)
        if (position - zero_pos) * (pos_90_pos - zero_pos) > 0:
            return 90.0 * (position - zero_pos) / (pos_90_pos - zero_pos)
        # For positions on the negative side (between zero and -90)
        else:
            return -90.0 * (position - zero_pos) / (neg_90_pos - zero_pos)

    def _read(self, data_name, servo_ids=None):
        if not self._is_connected:
            self.connect()

        servo_ids = servo_ids or self.servo_ids
        if isinstance(servo_ids, int):
            servo_ids = [servo_ids]

        addr, size = SCS_CONTROL_TABLE[data_name]
        group_key = f"{data_name}_{'_'.join(map(str, servo_ids))}"
        
        if group_key not in self._readers:
            reader = scs.GroupSyncRead(self.port_handler, self.packet_handler, addr, size)
            for servo_id in servo_ids:
                reader.addParam(servo_id)
            self._readers[group_key] = reader

        reader = self._readers[group_key]
        for _ in range(NUM_RETRY):
            if reader.txRxPacket() == scs.COMM_SUCCESS:
                break
        else:
            raise RuntimeError("Communication error during read")

        return np.array([reader.getData(id, addr, size) for id in servo_ids], dtype=np.int32)

    def _write(self, data_name, values=None, servo_ids=None):
        if not self._is_connected:
            self.connect()

        servo_ids = servo_ids or self.servo_ids
        if isinstance(servo_ids, int):
            servo_ids = [servo_ids]

        if values is None:
            values = [1] * len(servo_ids)
        if isinstance(values, (int, float, np.integer)):
            values = [values] * len(servo_ids)
            
        values = np.array(values, dtype=np.int32)
        addr, size = SCS_CONTROL_TABLE[data_name]
        group_key = f"{data_name}_{'_'.join(map(str, servo_ids))}"
        
        if group_key not in self._writers:
            writer = scs.GroupSyncWrite(self.port_handler, self.packet_handler, addr, size)
            self._writers[group_key] = writer
            for servo_id, val in zip(servo_ids, values):
                writer.addParam(servo_id, self._to_bytes(val, size))
        else:
            writer = self._writers[group_key]
            for servo_id, val in zip(servo_ids, values):
                writer.changeParam(servo_id, self._to_bytes(val, size))

        for _ in range(NUM_RETRY):
            if writer.txPacket() == scs.COMM_SUCCESS:
                break
        else:
            raise RuntimeError("Communication error during write")

    def _to_bytes(self, value, size):
        """Convert an integer value to a list of bytes for the SCS protocol."""
        if size == 1:
            return [value & 0xFF]
        elif size == 2:
            return [value & 0xFF, (value >> 8) & 0xFF]
        elif size == 4:
            return [
                value & 0xFF,
                (value >> 8) & 0xFF,
                (value >> 16) & 0xFF,
                (value >> 24) & 0xFF,
            ]
        else:
            raise ValueError(f"Unsupported byte size: {size}") 