import time
import numpy as np
import scservo_sdk as scs
import json
import os
import serial
import traceback

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
                 virtual_port=None,
                 servo_ids=None, 
                 p_coef=8, i_coef=0, d_coef=16, 
                 max_accel=254, accel=254,
                ):
        # Config and calibration file paths
        self.config_file = os.path.join(os.path.dirname(__file__), CONFIG_FILENAME)
        self.calibration_file = os.path.join(os.path.dirname(__file__), CALIBRATION_FILENAME)
        
        # Load configuration and calibration data
        self.config = self._load_config()
        self.calibration = self._load_calibration()
        
        # State tracking variables
        self.is_calibrated = bool(self.calibration)
        self.connected = False
        self.torque_enabled = False
        self.calibration_mode = False
        self.temp_calibration_data = {}
        
        # Use provided parameters or config values
        self.port = port or self.config.get('port')
        self.virtual_port = virtual_port or self.config.get('virtual_port')
        self.servo_ids = servo_ids or self.config.get('servo_ids', [])
        
        # Configuration parameters
        self.p_coef = p_coef
        self.i_coef = i_coef
        self.d_coef = d_coef
        self.max_accel = max_accel
        self.accel = accel
        
        # Internal tracking
        self._readers = {}
        self._writers = {}
        
        # Validate essential configuration
        if not self.port:
            raise ValueError("No port specified and no port found in config")
        
        if not self.servo_ids:
            raise ValueError("No servo IDs specified and no servo IDs found in config")
        
        # Note: We don't automatically connect or configure servos
 
    def connect(self):
        if self.connected:
            return
            
        self.port_handler = scs.PortHandler(self.port)
        self.packet_handler = scs.PacketHandler(PROTOCOL_VERSION)

        try:
            # Store the original setupPort method
            original_setup_port = self.port_handler.setupPort
            
            def virtual_port_setup(cflag_baud):
                if self.port_handler.is_open:
                    self.port_handler.closePort()

                self.port_handler.ser = serial.Serial(
                    port=self.port_handler.port_name,
                    # baudrate is intentionally not set here
                    bytesize=serial.EIGHTBITS,
                    timeout=0
                )

                self.port_handler.is_open = True
                self.port_handler.ser.reset_input_buffer()
                self.port_handler.tx_time_per_byte = (1000.0 / self.port_handler.baudrate) * 10.0
                return True
                
            # Replace the setupPort method based on virtual_port setting
            if self.virtual_port:
                self.port_handler.setupPort = virtual_port_setup
                print(f"[Servos] Using virtual port setup for {self.port}")
            
            if not self.port_handler.openPort():
                raise OSError(f"Failed to open port '{self.port}'")
            
            self.port_handler.setBaudRate(BAUDRATE)
            self.port_handler.setPacketTimeoutMillis(TIMEOUT_MS)
            self.connected = True
            print(f"Connected on {self.port}")
            self._configure_servos()
            self.set_torque_enabled(True)
        
        except Exception as e:
            traceback.print_exc()
            if hasattr(self, 'port_handler') and self.port_handler:
                self.port_handler.closePort()
            raise e

    def disconnect(self):
        if not self.connected:
            return
        
        # Disable torque when disconnecting
        if self.torque_enabled:
            self.set_torque_enabled(False)
            
        time.sleep(0.1)
            
        if hasattr(self, 'port_handler') and self.port_handler:
            self.port_handler.closePort()
            
        self._readers = {}
        self._writers = {}
        self.connected = False
        print("Disconnected")

    def get_torque_enabled(self):
        assert self.connected, "Not connected to servos. Call connect() first."
        return self.torque_enabled
    
    def set_torque_enabled(self, enabled):
        assert self.connected, "Not connected to servos. Call connect() first."
        self._write("Torque_Enable", 1 if enabled else 0)
        self.torque_enabled = enabled
        print(f"Torque {'enabled' if enabled else 'disabled'}")
        
    def get_positions(self):
        assert self.connected, "Not connected to servos. Call connect() first."
        
        positions = self._read("Present_Position", self.servo_ids)
        return {servo_id: int(pos) for servo_id, pos in zip(self.servo_ids, positions)}
    
    def set_position(self, positions):
        assert self.connected, "Not connected to servos. Call connect() first."
        assert self.torque_enabled, "Torque not enabled. Call enable_torque() first."
            
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
    
    # Calibration-dependent methods
    def get_angles(self):
        assert self.connected, "Not connected to servos. Call connect() first."
        assert self.is_calibrated, "Servos not calibrated. Run calibration procedure first."
        
        positions = self.get_positions()
        return {servo_id: self._position_to_angle(servo_id, pos) 
                for servo_id, pos in positions.items()}
    
    def set_angle(self, angles):
        assert self.connected, "Not connected to servos. Call connect() first."
        assert self.torque_enabled, "Torque not enabled. Call enable_torque() first."
        assert self.is_calibrated, "Servos not calibrated. Run calibration procedure first."
        
        positions = {}
        for servo_id, angle in angles.items():
            if servo_id not in self.servo_ids:
                raise ValueError(f"Unknown servo ID: {servo_id}")
            positions[servo_id] = self._angle_to_position(servo_id, angle)
            
        if positions:
            self.set_position(positions)

    # Calibration functions
    def start_calibration(self):
        assert self.connected, "Not connected to servos. Call connect() first."
        
        if self.calibration_mode:
            print("Calibration already in progress")
            return
            
        # Initialize temporary calibration data
        self.temp_calibration_data = {}
        self.calibration_mode = True
        
        # Always disable torque during calibration
        if self.torque_enabled:
            self.set_torque_enabled(False)
            
        print("Calibration started. Torque disabled.")
        
    def end_calibration(self):
        assert self.calibration_mode, "No calibration in progress. Call start_calibration() first."
            
        if not self.temp_calibration_data:
            print("No calibration points set, nothing to save")
            self.calibration_mode = False
            return
            
        # Check if all servos have all required calibration points
        required_points = ['zero', 'min', 'max']
        missing_points = {}
        
        for servo_id in self.servo_ids:
            servo_id_str = str(servo_id)
            if servo_id_str not in self.temp_calibration_data:
                missing_points[servo_id_str] = required_points
                continue
                
            servo_missing = []
            for point in required_points:
                if point not in self.temp_calibration_data[servo_id_str]:
                    servo_missing.append(point)
            
            if servo_missing:
                missing_points[servo_id_str] = servo_missing
        
        if missing_points:
            print("Incomplete calibration, cannot save:")
            for servo_id, points in missing_points.items():
                print(f"  Servo {servo_id} missing: {', '.join(points)}")
            self.calibration_mode = False
            return
            
        # Save calibration
        self.calibration = self.temp_calibration_data.copy()
        self.is_calibrated = True
        
        # Create directory if needed
        os.makedirs(os.path.dirname(self.calibration_file), exist_ok=True)
        
        # Save to file
        with open(self.calibration_file, 'w') as f:
            json.dump(self.calibration, f, indent=2)
            
        print(f"Calibration saved")
        self.calibration_mode = False
        self.temp_calibration_data = {}

        # Reload calibration
        self.calibration = self._load_calibration()
        self.is_calibrated = bool(self.calibration)

        self.set_torque_enabled(True)

        
    def cancel_calibration(self):
        if not self.calibration_mode:
            print("No calibration in progress")
            return
            
        # Restore previous calibration state
        self.temp_calibration_data = {}
        self.calibration_mode = False
        print("Calibration cancelled")

        self.set_torque_enabled(True)
        
    def set_calibration_point(self, servo_id, point_name, position=None): 
        assert self.connected, "Not connected to servos. Call connect() first."
        assert self.calibration_mode, "Calibration not in progress. Call start_calibration() first."
            
        if servo_id not in self.servo_ids:
            raise ValueError(f"Unknown servo ID: {servo_id}")
            
        if point_name not in ['zero', 'min', 'max']:
            raise ValueError(f"Invalid point name: {point_name}. Must be 'zero', 'min', or 'max'")
            
        # If no position provided, use current position
        if position is None:
            position = self.get_positions()[servo_id]
            
        # Update temp calibration
        servo_cal = self.temp_calibration_data.setdefault(str(servo_id), {})
        servo_cal[point_name] = position
        print(f"Set {point_name} for servo {servo_id}: {position}")
        
    def iterative_calibration(self):
        assert self.connected, "Not connected to servos. Call connect() first."
        
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
        assert self.connected, "Not connected to servos. Call connect() first."

        servo_ids = servo_ids or self.servo_ids
        if isinstance(servo_ids, int):
            servo_ids = [servo_ids]

        addr, size = SCS_CONTROL_TABLE[data_name]
        group_key = f"{data_name}_{'_'.join(map(str, servo_ids))}"

        # Always recreate the reader to avoid stale state
        reader = scs.GroupSyncRead(self.port_handler, self.packet_handler, addr, size)
        for servo_id in servo_ids:
            reader.addParam(servo_id)

        # Reset buffers before each read
        self.port_handler.ser.reset_output_buffer()
        self.port_handler.ser.reset_input_buffer()

        for attempt in range(NUM_RETRY):
            if reader.txRxPacket() == scs.COMM_SUCCESS:
                break
            if attempt < NUM_RETRY - 1:
                time.sleep(0.05)
        else:
            raise RuntimeError(f"Communication error during read after {NUM_RETRY} retries")

        return np.array([reader.getData(id, addr, size) for id in servo_ids], dtype=np.int32)

    def _write(self, data_name, values=None, servo_ids=None):
        assert self.connected, "Not connected to servos. Call connect() first."

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

        # Always recreate the writer to avoid stale state
        writer = scs.GroupSyncWrite(self.port_handler, self.packet_handler, addr, size)
        for servo_id, val in zip(servo_ids, values):
            writer.addParam(servo_id, self._to_bytes(val, size))

        # Reset buffers before each write
        self.port_handler.ser.reset_output_buffer()
        self.port_handler.ser.reset_input_buffer()

        for attempt in range(NUM_RETRY):
            if writer.txPacket() == scs.COMM_SUCCESS:
                break
            if attempt < NUM_RETRY - 1:
                time.sleep(0.05)
        else:
            raise RuntimeError("Communication error during write")

    def _configure_servos(self):
        assert self.connected, "Not connected to servos. Call connect() first."
            
        # Configure but don't automatically enable torque
        for servo_id in self.servo_ids:
            self._write("Mode", 0, servo_id)
            self._write("P_Coefficient", self.p_coef, servo_id)
            self._write("I_Coefficient", self.i_coef, servo_id)
            self._write("D_Coefficient", self.d_coef, servo_id)            
            self._write("Lock", 0, servo_id)
            self._write("Maximum_Acceleration", self.max_accel, servo_id)
            self._write("Acceleration", self.accel, servo_id)
            
        print("Servos configured")

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
        assert self.is_calibrated, "Servos not calibrated. Run calibration procedure first."
        
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
        assert self.is_calibrated, "Servos not calibrated. Run calibration procedure first."
        
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