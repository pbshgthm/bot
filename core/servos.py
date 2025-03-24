import time
import numpy as np
import scservo_sdk as scs
import json
import os

PROTOCOL_VERSION = 0
BAUDRATE = 1_000_000
TIMEOUT_MS = 1000
NUM_RETRY = 10

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

CONFIG_FILENAME = "data/config.json"
CALIBRATION_FILENAME = "data/calibration.json"

class Servos:
    def __init__(self, 
                 port=None, 
                 servo_ids=None, 
                 p_coef=8, i_coef=0, d_coef=16, 
                 max_accel=254, accel=254):
        # Load config and calibration
        self.config_file = os.path.join(os.path.dirname(__file__), CONFIG_FILENAME)
        self.calibration_file = os.path.join(os.path.dirname(__file__), CALIBRATION_FILENAME)
        self.config = self._load_config()
        self.calibration = self._load_calibration()

        self.is_calibrated = bool(self.calibration)
        self.draft_calibration = self.calibration.copy() if self.is_calibrated else {}
        
        # Use provided parameters or config values
        self.port = port or self.config.get('port')
        self.servo_ids = servo_ids or self.config.get('servo_ids', [])
        
        # Configuration parameters
        self.p_coef = p_coef
        self.i_coef = i_coef
        self.d_coef = d_coef
        self.max_accel = max_accel
        self.accel = accel
        
        # State tracking
        self._torque_enabled = False
        self._calibration_in_progress = False
        self._is_connected = False
        self._readers = {}
        self._writers = {}
        
        if not self.port:
            raise ValueError("No port specified and no port found in config")
        
        if not self.servo_ids:
            raise ValueError("No servo IDs specified and no servo IDs found in config")
        
        # Automatically connect and configure servos
        self.connect()
        self._configure_servos()
 
    def connect(self):
        if self._is_connected:
            return
            
        self.port_handler = scs.PortHandler(self.port)
        self.packet_handler = scs.PacketHandler(PROTOCOL_VERSION)

        try:
            if not self.port_handler.openPort():
                raise OSError(f"Failed to open port '{self.port}'")
            
            self.port_handler.setBaudRate(BAUDRATE)
            self.port_handler.setPacketTimeoutMillis(TIMEOUT_MS)
            self._is_connected = True
            print(f"Connected on {self.port}")
        
        except Exception as e:
            if hasattr(self, 'port_handler') and self.port_handler:
                self.port_handler.closePort()
            raise e

    def disconnect(self):
        if not self._is_connected:
            return
        
        # Disable torque when disconnecting
        if self._torque_enabled:
            self._write("Torque_Enable", 0)
            self._torque_enabled = False
            
        time.sleep(0.1)
            
        if hasattr(self, 'port_handler') and self.port_handler:
            self.port_handler.closePort()
            
        self._readers = {}
        self._writers = {}
        self._is_connected = False
        print("Disconnected")

    def _configure_servos(self):
        if not self._is_connected:
            self.connect()
            
        # Configure but don't automatically enable torque
        for servo_id in self.servo_ids:
            self._write("Mode", 0, servo_id)
            self._write("P_Coefficient", self.p_coef, servo_id)
            self._write("I_Coefficient", self.i_coef, servo_id)
            self._write("D_Coefficient", self.d_coef, servo_id)            
            self._write("Lock", 0, servo_id)
            self._write("Maximum_Acceleration", self.max_accel, servo_id)
            self._write("Acceleration", self.accel, servo_id)

    # Core servo control functions
    def enable_torque(self):
        if not self._is_connected:
            self.connect()
            
        self._write("Torque_Enable", 1)
        self._torque_enabled = True
        print("Torque enabled")
        
    def disable_torque(self):
        if not self._is_connected:
            self.connect()
            
        self._write("Torque_Enable", 0)
        self._torque_enabled = False
        print("Torque disabled")
        
    def get_positions(self):
        positions = self._read("Present_Position", self.servo_ids)
        return {servo_id: int(pos) for servo_id, pos in zip(self.servo_ids, positions)}
    
    def set_position(self, positions):
        if not self._torque_enabled:
            raise RuntimeError("Cannot set position: Torque not enabled. Call enable_torque() first.")
            
        pos_values = []
        servo_ids = []
        
        for servo_id, position in positions.items():
            if servo_id not in self.servo_ids:
                raise ValueError(f"Unknown servo ID: {servo_id}")
                
            pos_values.append(int(position))
            servo_ids.append(servo_id)
        
        if pos_values:
            self._write("Goal_Position", pos_values, servo_ids)
            
    def get_servos(self):
        return self.servo_ids

    def status(self):
        if "calibration" in self.config:
            print(f"Calibration: {self.config['calibration']}")
        else:
            print("No calibration found")

        try:
            positions = self.get_positions() 
            return {servo_id: servo_id in positions for servo_id in self.servo_ids}
        except Exception:
            return {servo_id: False for servo_id in self.servo_ids}

    # Calibration functions
    def start_calibration(self):
        if self._calibration_in_progress:
            print("Calibration already in progress")
            return
            
        self.draft_calibration = {}
        self._calibration_in_progress = True
        
        self.disable_torque()
        print("Calibration started. Torque disabled.")
        
    def end_calibration(self):
        if not self._calibration_in_progress:
            print("No calibration in progress")
            return
            
        if not self.draft_calibration:
            print("No calibration points set, nothing to save")
            self._calibration_in_progress = False
            return
            
        # Save calibration
        self.calibration = self.draft_calibration.copy()
        self.is_calibrated = True
        
        # Create directory if needed
        os.makedirs(os.path.dirname(self.calibration_file), exist_ok=True)
        
        # Save to file
        with open(self.calibration_file, 'w') as f:
            json.dump(self.calibration, f, indent=2)
            
        print(f"Calibration saved")
        self._calibration_in_progress = False

        # Reload calibration
        self._load_calibration()
        self.is_calibrated = bool(self.calibration)
        self.draft_calibration = self.calibration.copy() if self.is_calibrated else {}


        
    def cancel_calibration(self):
        if not self._calibration_in_progress:
            print("No calibration in progress")
            return
            
        # Restore previous calibration
        self.draft_calibration = self.calibration.copy() if self.is_calibrated else {}
        self._calibration_in_progress = False
        print("Calibration cancelled")
        
    def set_calibration_point(self, servo_id, point_name, position=None): 
        if not self._calibration_in_progress:
            raise RuntimeError("Calibration not in progress. Call start_calibration() first.")
            
        if servo_id not in self.servo_ids:
            raise ValueError(f"Unknown servo ID: {servo_id}")
            
        if point_name not in ['zero', 'min', 'max']:
            raise ValueError(f"Invalid point name: {point_name}. Must be 'zero', 'min', or 'max'")
            
        # If no position provided, use current position
        if position is None:
            position = self.get_positions()[servo_id]
            
        # Update draft calibration
        servo_cal = self.draft_calibration.setdefault(str(servo_id), {})
        servo_cal[point_name] = position
        print(f"Set {point_name} for servo {servo_id}: {position}")
        
    def iterative_calibration(self):
        # Start calibration process
        self.start_calibration()
        
        try:    
            # Process one servo at a time
            for servo_id in self.servo_ids:
                print(f"\n=== Calibrating Servo ID {servo_id} ===")
                
                # Zero position
                input(f"Move servo {servo_id} to ZERO position and press Enter...")
                positions = self.get_positions()
                zero_pos = positions[servo_id]
                self.set_calibration_point(servo_id, "zero", zero_pos)
                
                input(f"Move servo {servo_id} to MINIMUM position and press Enter...")
                positions = self.get_positions()
                min_pos = positions[servo_id]
                self.set_calibration_point(servo_id, "min", min_pos)
                
                input(f"Move servo {servo_id} to MAXIMUM position and press Enter...")
                positions = self.get_positions()
                max_pos = positions[servo_id]
                self.set_calibration_point(servo_id, "max", max_pos)
                
                print(f"Calibration complete for servo {servo_id}")
            
            if input("\nSave calibration data? (y/n): ").lower().startswith('y'):
                self.end_calibration()
                self.enable_torque()
            else:
                self.cancel_calibration()
        
        except Exception as e:
            self.cancel_calibration()
            print(f"Calibration failed: {e}")
        

    # Config and file operations
    def _load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                print(f"Config loaded")
                return config
            else:
                print(f"Config file not found")
                return {}
        except Exception as e:
            print(f"Error loading config: {e}")
            return {}
        
    def _load_calibration(self):
        try:
            if os.path.exists(self.calibration_file):
                with open(self.calibration_file, 'r') as f:
                    calibration = json.load(f)
                print(f"Calibration loaded")
                return calibration
            else:
                print(f"Calibration file not found")
                return {}
        except Exception as e:
            print(f"Error loading calibration: {e}")
            return {}

    # Low-level communication
    def _read(self, data_name, servo_ids=None):
        if not self._is_connected:
            self.connect()

        self.port_handler.ser.reset_output_buffer()
        self.port_handler.ser.reset_input_buffer()

        # If no servo IDs specified, use all servo IDs
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

        self.port_handler.ser.reset_output_buffer()
        self.port_handler.ser.reset_input_buffer()

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
        
    def _position_to_angle(self, servo_id, position):
        """Convert servo position to angle in degrees."""
        servo_id_str = str(servo_id)
        zero = self.calibration[servo_id_str]['zero']
        min_pos = self.calibration[servo_id_str]['min']
        max_pos = self.calibration[servo_id_str]['max']
        
        if position == zero:
            return 0.0
            
        is_reversed = min_pos > max_pos
        
        # For reversed servos, swap min and max to calculate correctly
        actual_min = max_pos if is_reversed else min_pos
        actual_max = min_pos if is_reversed else max_pos
        
        # Calculate full range and position relative to zero
        full_range = abs(actual_max - actual_min)
        if full_range == 0:
            return 0.0  # Prevent division by zero
            
        if position > zero:
            # Positive angle range (0 to 90)
            pos_range = abs(actual_max - zero)
            if pos_range == 0:
                return 0.0
            
            relative_pos = abs(position - zero)
            angle = 90.0 * relative_pos / pos_range
            
            # If reversed and position > zero, we're in negative angle territory
            return -angle if is_reversed else angle
        else:
            # Negative angle range (0 to -90)
            neg_range = abs(zero - actual_min)
            if neg_range == 0:
                return 0.0
                
            relative_pos = abs(zero - position)
            angle = 90.0 * relative_pos / neg_range
            
            # If reversed and position < zero, we're in positive angle territory
            return angle if is_reversed else -angle
        
    def _angle_to_position(self, servo_id, angle):
        """Convert angle in degrees to servo position."""
        servo_id_str = str(servo_id)
        zero = self.calibration[servo_id_str]['zero']
        min_pos = self.calibration[servo_id_str]['min']
        max_pos = self.calibration[servo_id_str]['max']
        
        if angle == 0.0:
            return zero
            
        is_reversed = min_pos > max_pos
        
        # For reversed servos, swap min and max to calculate correctly
        actual_min = max_pos if is_reversed else min_pos
        actual_max = min_pos if is_reversed else max_pos
        
        # Reverse the angle for reversed servos
        working_angle = -angle if is_reversed else angle
        
        if working_angle > 0:
            # Positive angle range (0 to 90)
            pos_range = abs(actual_max - zero)
            return int(zero + (working_angle / 90.0 * pos_range))
        else:
            # Negative angle range (0 to -90)
            neg_range = abs(zero - actual_min)
            return int(zero - (abs(working_angle) / 90.0 * neg_range)) 