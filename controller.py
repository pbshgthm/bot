import pygame
import sys
import math
import numpy as np
from pygame.locals import *

# Initialize pygame
pygame.init()
pygame.joystick.init()

# Set up display with OpenGL support
WIDTH, HEIGHT = 1200, 900  # Increased resolution
pygame.display.set_mode((WIDTH, HEIGHT), DOUBLEBUF | OPENGL)
pygame.display.set_caption("3D 4-DOF Robotic Arm Controller")

# Import OpenGL modules
from OpenGL.GL import *
from OpenGL.GLU import *
from OpenGL.GLUT import *

# Initialize GLUT for 3D shapes
glutInit()

# Set up the font
font = pygame.font.Font(None, 36)
font_surface = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)

# Colors - OpenGL format (0.0-1.0) - More soothing palette
BLACK_GL = (0.0, 0.0, 0.0)
WHITE_GL = (1.0, 1.0, 1.0)
GRAY_GL = (0.7, 0.7, 0.7)
RED_GL = (0.8, 0.2, 0.2)  # Softer red
GREEN_GL = (0.2, 0.7, 0.3)  # Softer green
BLUE_GL = (0.2, 0.4, 0.8)  # Softer blue
YELLOW_GL = (0.9, 0.8, 0.2)  # Softer yellow
ORANGE_GL = (0.9, 0.6, 0.2)  # Softer orange
TEAL_GL = (0.2, 0.7, 0.7)  # New teal color
PURPLE_GL = (0.6, 0.3, 0.7)  # New purple color

# Translucent versions of the colors
RED_TRANS_GL = (0.8, 0.2, 0.2, 0.3)
BLUE_TRANS_GL = (0.2, 0.4, 0.8, 0.3)
GREEN_TRANS_GL = (0.2, 0.7, 0.3, 0.3)
TEAL_TRANS_GL = (0.2, 0.7, 0.7, 0.3)
PURPLE_TRANS_GL = (0.6, 0.3, 0.7, 0.3)
ORANGE_TRANS_GL = (0.9, 0.6, 0.2, 0.3)

# Colors - Pygame format (0-255)
PG_BLACK = (0, 0, 0)
PG_WHITE = (255, 255, 255)
PG_GRAY = (180, 180, 180)
PG_RED = (204, 51, 51)
PG_GREEN = (51, 179, 76)
PG_BLUE = (51, 102, 204)
PG_YELLOW = (230, 204, 51)
PG_ORANGE = (230, 153, 51)
PG_TEAL = (51, 179, 179)
PG_PURPLE = (153, 76, 179)

# Function to convert OpenGL color to Pygame color with alpha
def gl_to_pygame_color(gl_color, alpha=255):
    return tuple(int(c * 255) for c in gl_color) + (alpha,)

# Camera/view parameters
camera_distance = 600  # Increased starting distance for better view
camera_rot_x = 30  # degrees
camera_rot_y = 45  # degrees
orbit_sensitivity = 0.5

# Mouse state for orbit control
mouse_pressed = False
prev_mouse_pos = None

# Detect controllers
if pygame.joystick.get_count() == 0:
    print("No controller detected!")
    exit()

controller = pygame.joystick.Joystick(0)
controller.init()

print(f"Connected to {controller.get_name()}")

# 3D Arm parameters
# Base is at the origin, first rotation is around Y axis
# Each segment extends along its local X axis after rotation
BASE_HEIGHT = 80  # Increased from 50 to 80 for longer base
BASE_RADIUS = 25  # Radius of the base cylinder
CONNECTOR_HEIGHT = 15  # Height of the connector piece between base and first joint
SEGMENT_LENGTHS = [120, 100, 80, 60]  # Length of each arm segment
SEGMENT_RADII = [15, 10, 8, 6]  # Radius of each arm segment
JOINT_RADII = [18, 12, 10, 8]  # Radius of each joint

# Angle limits in radians
MIN_ANGLE = math.radians(-120)
MAX_ANGLE = math.radians(120)

# Joint angles (in radians) - all start at 0
joint_angles = [0, 0, 0, 0]  # [base_yaw, shoulder_pitch, elbow_pitch, wrist_pitch]

def setup_lighting():
    """Set up OpenGL lighting for better aesthetics"""
    glEnable(GL_LIGHTING)
    glEnable(GL_LIGHT0)
    glEnable(GL_LIGHT1)  # Added second light
    glEnable(GL_COLOR_MATERIAL)
    glColorMaterial(GL_FRONT_AND_BACK, GL_AMBIENT_AND_DIFFUSE)
    
    # Light position (from upper right)
    glLightfv(GL_LIGHT0, GL_POSITION, (500, 500, 500, 1))
    # Ambient light
    glLightfv(GL_LIGHT0, GL_AMBIENT, (0.3, 0.3, 0.3, 1))  # Increased ambient
    # Diffuse light
    glLightfv(GL_LIGHT0, GL_DIFFUSE, (0.8, 0.8, 0.8, 1))
    # Specular light
    glLightfv(GL_LIGHT0, GL_SPECULAR, (1, 1, 1, 1))
    
    # Second light from another angle
    glLightfv(GL_LIGHT1, GL_POSITION, (-300, 300, -200, 1))
    glLightfv(GL_LIGHT1, GL_DIFFUSE, (0.5, 0.5, 0.6, 1))  # Slightly blue tint
    glLightfv(GL_LIGHT1, GL_SPECULAR, (0.5, 0.5, 0.6, 1))
    
    # Set material properties for better look
    glMaterialfv(GL_FRONT, GL_SHININESS, 50.0)
    glMaterialfv(GL_FRONT, GL_SPECULAR, (0.7, 0.7, 0.7, 1.0))

def setup_3d():
    """Set up the 3D rendering environment"""
    glEnable(GL_DEPTH_TEST)
    glEnable(GL_NORMALIZE)  # Normalize normals for proper lighting
    glShadeModel(GL_SMOOTH)  # Smooth shading
    
    # Set up the projection matrix
    glMatrixMode(GL_PROJECTION)
    glLoadIdentity()
    gluPerspective(45, WIDTH/HEIGHT, 0.1, 2000)
    
    # Set up the model view matrix
    glMatrixMode(GL_MODELVIEW)
    glLoadIdentity()
    
    # Set up lighting
    setup_lighting()

def update_camera():
    """Update camera position based on orbit controls"""
    glLoadIdentity()
    
    # Convert spherical coordinates to Cartesian
    x = camera_distance * math.sin(math.radians(camera_rot_y)) * math.cos(math.radians(camera_rot_x))
    y = camera_distance * math.sin(math.radians(camera_rot_x))
    z = camera_distance * math.cos(math.radians(camera_rot_y)) * math.cos(math.radians(camera_rot_x))
    
    # Set camera position and target
    gluLookAt(x, y, z,  # Camera position 
              0, 0, 0,   # Look at origin
              0, 1, 0)   # Up vector

def draw_cylinder(radius, height, slices=32):  # Increased slices for smoother cylinders
    """Draw a cylinder with the given radius and height along the Z axis"""
    quad = gluNewQuadric()
    gluQuadricNormals(quad, GLU_SMOOTH)
    gluQuadricTexture(quad, GL_TRUE)  # Enable texture coordinates
    
    # Draw the cylinder body
    gluCylinder(quad, radius, radius, height, slices, 2)  # Increased stacks for smoothness
    
    # Draw top cap
    glPushMatrix()
    glTranslatef(0, 0, height)
    gluDisk(quad, 0, radius, slices, 2)
    glPopMatrix()
    
    # Draw bottom cap
    glPushMatrix()
    glRotatef(180, 1, 0, 0)
    gluDisk(quad, 0, radius, slices, 2)
    glPopMatrix()
    
    gluDeleteQuadric(quad)

def draw_sphere(radius, slices=32, stacks=32):  # Increased slices/stacks for smoother spheres
    """Draw a sphere with the given radius"""
    quad = gluNewQuadric()
    gluQuadricNormals(quad, GLU_SMOOTH)
    gluQuadricTexture(quad, GL_TRUE)  # Enable texture coordinates
    gluSphere(quad, radius, slices, stacks)
    gluDeleteQuadric(quad)

def draw_arc_with_volume(radius, height, start_angle, end_angle, rotation_axis, segments=40, stacks=8):
    """Draw a 3D volumetric arc representing the range of motion of a joint"""
    # Enable blending for translucency
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    
    angle_range = end_angle - start_angle
    
    # Draw a series of quads to create a volumetric arc
    for stack in range(stacks):
        # Calculate the top and bottom of the current stack
        bottom_ratio = stack / stacks
        top_ratio = (stack + 1) / stacks
        
        bottom_y = -height/2 + height * bottom_ratio
        top_y = -height/2 + height * top_ratio
        
        for i in range(segments):
            # Calculate the start and end angles for this segment
            seg_start_ratio = i / segments
            seg_end_ratio = (i + 1) / segments
            
            seg_start_angle = start_angle + angle_range * seg_start_ratio
            seg_end_angle = start_angle + angle_range * seg_end_ratio
            
            # Calculate points for the quad
            if rotation_axis == 'y':  # For base rotation (around Y axis)
                # Begin drawing the quad
                glBegin(GL_QUADS)
                
                # Inner bottom point 1
                x1 = radius * 0.9 * math.sin(seg_start_angle)
                z1 = radius * 0.9 * math.cos(seg_start_angle)
                glVertex3f(x1, bottom_y, z1)
                
                # Inner bottom point 2
                x2 = radius * 0.9 * math.sin(seg_end_angle)
                z2 = radius * 0.9 * math.cos(seg_end_angle)
                glVertex3f(x2, bottom_y, z2)
                
                # Inner top point 2
                glVertex3f(x2, top_y, z2)
                
                # Inner top point 1
                glVertex3f(x1, top_y, z1)
                
                glEnd()
                
                # Outer surface
                glBegin(GL_QUADS)
                
                # Outer bottom point 1
                x1 = radius * 1.1 * math.sin(seg_start_angle)
                z1 = radius * 1.1 * math.cos(seg_start_angle)
                glVertex3f(x1, bottom_y, z1)
                
                # Outer bottom point 2
                x2 = radius * 1.1 * math.sin(seg_end_angle)
                z2 = radius * 1.1 * math.cos(seg_end_angle)
                glVertex3f(x2, bottom_y, z2)
                
                # Outer top point 2
                glVertex3f(x2, top_y, z2)
                
                # Outer top point 1
                glVertex3f(x1, top_y, z1)
                
                glEnd()
                
                # Top and bottom caps if we're at the edges of the arc
                if i == 0 or i == segments - 1:
                    glBegin(GL_QUADS)
                    
                    if i == 0:
                        angle = seg_start_angle
                    else:
                        angle = seg_end_angle
                    
                    # Inner bottom
                    x1 = radius * 0.9 * math.sin(angle)
                    z1 = radius * 0.9 * math.cos(angle)
                    glVertex3f(x1, bottom_y, z1)
                    
                    # Outer bottom
                    x2 = radius * 1.1 * math.sin(angle)
                    z2 = radius * 1.1 * math.cos(angle)
                    glVertex3f(x2, bottom_y, z2)
                    
                    # Outer top
                    glVertex3f(x2, top_y, z2)
                    
                    # Inner top
                    glVertex3f(x1, top_y, z1)
                    
                    glEnd()
                
            else:  # For pitch joints (around Z axis)
                # Begin drawing the quad
                glBegin(GL_QUADS)
                
                # Inner bottom point 1
                x1 = radius * 0.9 * math.cos(seg_start_angle)
                y1 = radius * 0.9 * math.sin(seg_start_angle)
                glVertex3f(x1, y1, bottom_y)
                
                # Inner bottom point 2
                x2 = radius * 0.9 * math.cos(seg_end_angle)
                y2 = radius * 0.9 * math.sin(seg_end_angle)
                glVertex3f(x2, y2, bottom_y)
                
                # Inner top point 2
                glVertex3f(x2, y2, top_y)
                
                # Inner top point 1
                glVertex3f(x1, y1, top_y)
                
                glEnd()
                
                # Outer surface
                glBegin(GL_QUADS)
                
                # Outer bottom point 1
                x1 = radius * 1.1 * math.cos(seg_start_angle)
                y1 = radius * 1.1 * math.sin(seg_start_angle)
                glVertex3f(x1, y1, bottom_y)
                
                # Outer bottom point 2
                x2 = radius * 1.1 * math.cos(seg_end_angle)
                y2 = radius * 1.1 * math.sin(seg_end_angle)
                glVertex3f(x2, y2, bottom_y)
                
                # Outer top point 2
                glVertex3f(x2, y2, top_y)
                
                # Outer top point 1
                glVertex3f(x1, y1, top_y)
                
                glEnd()
                
                # Top and bottom caps if we're at the edges of the arc
                if i == 0 or i == segments - 1:
                    glBegin(GL_QUADS)
                    
                    if i == 0:
                        angle = seg_start_angle
                    else:
                        angle = seg_end_angle
                    
                    # Inner bottom
                    x1 = radius * 0.9 * math.cos(angle)
                    y1 = radius * 0.9 * math.sin(angle)
                    glVertex3f(x1, y1, bottom_y)
                    
                    # Outer bottom
                    x2 = radius * 1.1 * math.cos(angle)
                    y2 = radius * 1.1 * math.sin(angle)
                    glVertex3f(x2, y2, bottom_y)
                    
                    # Outer top
                    glVertex3f(x2, y2, top_y)
                    
                    # Inner top
                    glVertex3f(x1, y1, top_y)
                    
                    glEnd()
    
    # Draw top and bottom caps for the arcs
    for cap_y, invert in [(top_y, False), (bottom_y, True)]:
        angle_step = angle_range / segments
        
        for i in range(segments):
            angle = start_angle + i * angle_step
            next_angle = start_angle + (i + 1) * angle_step
            
            glBegin(GL_QUADS)
            
            if rotation_axis == 'y':
                # Inner point 1
                x1 = radius * 0.9 * math.sin(angle)
                z1 = radius * 0.9 * math.cos(angle)
                
                # Outer point 1
                x2 = radius * 1.1 * math.sin(angle)
                z2 = radius * 1.1 * math.cos(angle)
                
                # Inner point 2
                x3 = radius * 0.9 * math.sin(next_angle)
                z3 = radius * 0.9 * math.cos(next_angle)
                
                # Outer point 2
                x4 = radius * 1.1 * math.sin(next_angle)
                z4 = radius * 1.1 * math.cos(next_angle)
                
                if invert:
                    glVertex3f(x1, cap_y, z1)
                    glVertex3f(x2, cap_y, z2)
                    glVertex3f(x4, cap_y, z4)
                    glVertex3f(x3, cap_y, z3)
                else:
                    glVertex3f(x3, cap_y, z3)
                    glVertex3f(x4, cap_y, z4)
                    glVertex3f(x2, cap_y, z2)
                    glVertex3f(x1, cap_y, z1)
            else:
                # Inner point 1
                x1 = radius * 0.9 * math.cos(angle)
                y1 = radius * 0.9 * math.sin(angle)
                
                # Outer point 1
                x2 = radius * 1.1 * math.cos(angle)
                y2 = radius * 1.1 * math.sin(angle)
                
                # Inner point 2
                x3 = radius * 0.9 * math.cos(next_angle)
                y3 = radius * 0.9 * math.sin(next_angle)
                
                # Outer point 2
                x4 = radius * 1.1 * math.cos(next_angle)
                y4 = radius * 1.1 * math.sin(next_angle)
                
                if invert:
                    glVertex3f(x1, y1, cap_y)
                    glVertex3f(x2, y2, cap_y)
                    glVertex3f(x4, y4, cap_y)
                    glVertex3f(x3, y3, cap_y)
                else:
                    glVertex3f(x3, y3, cap_y)
                    glVertex3f(x4, y4, cap_y)
                    glVertex3f(x2, y2, cap_y)
                    glVertex3f(x1, y1, cap_y)
            
            glEnd()
    
    glDisable(GL_BLEND)

def draw_base():
    """Draw the base cylinder"""
    glPushMatrix()
    
    # Draw the main base
    glColor3f(*RED_GL)
    # Translate to floor and draw vertical cylinder
    glTranslatef(0, -BASE_HEIGHT/2, 0)  # Center cylinder vertically with bottom at the floor
    glRotatef(90, 1, 0, 0)  # Rotate to align with Y axis (vertical)
    draw_cylinder(BASE_RADIUS, BASE_HEIGHT)
    
    glPopMatrix()

def draw_connector():
    """Draw the connector between the base and first joint"""
    glPushMatrix()
    
    # Position at the top of the base
    glTranslatef(0, BASE_HEIGHT/2, 0)
    
    # Draw a tapered cylinder for a smooth transition from red to orange
    glColor3f(*RED_GL)
    quad = gluNewQuadric()
    gluQuadricNormals(quad, GLU_SMOOTH)
    glRotatef(90, 1, 0, 0)  # Rotate to align with Y axis
    
    # Draw connector cylinder that tapers from base radius to joint radius
    gluCylinder(quad, BASE_RADIUS * 0.8, JOINT_RADII[0] * 1.2, CONNECTOR_HEIGHT, 32, 2)
    
    # Draw top cap of connector (orange color for transition)
    glColor3f(*ORANGE_GL)
    glTranslatef(0, 0, CONNECTOR_HEIGHT)
    gluDisk(quad, 0, JOINT_RADII[0] * 1.2, 32, 2)
    
    gluDeleteQuadric(quad)
    
    glPopMatrix()

def draw_arm_segment(length, radius, color, joint_radius=None, trans_color=None):
    """Draw a single arm segment with specified parameters"""
    if joint_radius is None:
        joint_radius = radius * 1.2
    
    # Draw joint sphere
    glColor3f(*color)
    draw_sphere(joint_radius)
    
    # Draw segment cylinder (along X axis)
    glPushMatrix()
    glRotatef(90, 0, 1, 0)  # Rotate to align with X axis
    draw_cylinder(radius, length)
    glPopMatrix()

def draw_robotic_arm():
    """Draw the 3D robotic arm with proper hierarchical transformations"""
    # Draw the base (fixed to ground)
    draw_base()
    
    # Draw the connector between base and arm
    draw_connector()
    
    # Draw the arm starting from the top of the base
    glPushMatrix()
    
    # Position at the top of the connector
    glTranslatef(0, BASE_HEIGHT/2 + CONNECTOR_HEIGHT, 0)
    
    # Draw range of motion for the base joint
    glColor4f(*RED_TRANS_GL)
    draw_arc_with_volume(SEGMENT_LENGTHS[0] * 0.8, 20, MIN_ANGLE, MAX_ANGLE, 'y')
    
    # First joint (rotates around Y axis - yaw)
    glRotatef(math.degrees(joint_angles[0]), 0, 1, 0)
    
    # Draw first arm segment
    glColor3f(*BLUE_GL)
    draw_sphere(JOINT_RADII[0])
    
    glPushMatrix()
    glRotatef(90, 0, 1, 0)  # Rotate to align with X axis
    draw_cylinder(SEGMENT_RADII[0], SEGMENT_LENGTHS[0])
    glPopMatrix()
    
    # Move to end of first segment for second joint
    glTranslatef(SEGMENT_LENGTHS[0], 0, 0)
    
    # Draw range of motion for the shoulder joint
    glColor4f(*TEAL_TRANS_GL)
    draw_arc_with_volume(SEGMENT_LENGTHS[1] * 0.8, 20, MIN_ANGLE, MAX_ANGLE, 'z')
    
    # Second joint (rotates around Z axis - pitch)
    glRotatef(math.degrees(joint_angles[1]), 0, 0, 1)
    
    # Draw second arm segment
    glColor3f(*TEAL_GL)
    draw_sphere(JOINT_RADII[1])
    
    glPushMatrix()
    glRotatef(90, 0, 1, 0)
    draw_cylinder(SEGMENT_RADII[1], SEGMENT_LENGTHS[1])
    glPopMatrix()
    
    # Move to end of second segment for third joint
    glTranslatef(SEGMENT_LENGTHS[1], 0, 0)
    
    # Draw range of motion for the elbow joint
    glColor4f(*GREEN_TRANS_GL)
    draw_arc_with_volume(SEGMENT_LENGTHS[2] * 0.8, 20, MIN_ANGLE, MAX_ANGLE, 'z')
    
    # Third joint (rotates around Z axis - pitch)
    glRotatef(math.degrees(joint_angles[2]), 0, 0, 1)
    
    # Draw third arm segment
    glColor3f(*GREEN_GL)
    draw_sphere(JOINT_RADII[2])
    
    glPushMatrix()
    glRotatef(90, 0, 1, 0)
    draw_cylinder(SEGMENT_RADII[2], SEGMENT_LENGTHS[2])
    glPopMatrix()
    
    # Move to end of third segment for fourth joint
    glTranslatef(SEGMENT_LENGTHS[2], 0, 0)
    
    # Draw range of motion for the wrist joint
    glColor4f(*PURPLE_TRANS_GL)
    draw_arc_with_volume(SEGMENT_LENGTHS[3] * 0.8, 20, MIN_ANGLE, MAX_ANGLE, 'z')
    
    # Fourth joint (rotates around Z axis - roll)
    glRotatef(math.degrees(joint_angles[3]), 0, 0, 1)
    
    # Draw fourth arm segment (end effector)
    glColor3f(*PURPLE_GL)
    draw_sphere(JOINT_RADII[3])
    
    glPushMatrix()
    glRotatef(90, 0, 1, 0)
    draw_cylinder(SEGMENT_RADII[3], SEGMENT_LENGTHS[3])
    glPopMatrix()
    
    # End effector tip
    glTranslatef(SEGMENT_LENGTHS[3], 0, 0)
    glColor3f(*YELLOW_GL)
    draw_sphere(SEGMENT_RADII[3] * 0.8)
    
    glPopMatrix()  # Pop the entire arm matrix

def draw_grid():
    """Draw a 3D grid on the XZ plane for reference"""
    glDisable(GL_LIGHTING)  # Turn off lighting for grid
    
    glBegin(GL_LINES)
    grid_size = 10
    grid_step = 50
    
    # Draw along X axis (red lines)
    glColor4f(0.5, 0.2, 0.2, 0.5)  # Semi-transparent
    for i in range(-grid_size, grid_size + 1):
        z = i * grid_step
        glVertex3f(-grid_size * grid_step, 0, z)
        glVertex3f(grid_size * grid_step, 0, z)
    
    # Draw along Z axis (blue lines)
    glColor4f(0.2, 0.2, 0.5, 0.5)  # Semi-transparent
    for i in range(-grid_size, grid_size + 1):
        x = i * grid_step
        glVertex3f(x, 0, -grid_size * grid_step)
        glVertex3f(x, 0, grid_size * grid_step)
    
    # Draw center lines more prominently
    # X axis
    glColor3f(0.7, 0.2, 0.2)
    glVertex3f(-grid_size * grid_step, 0, 0)
    glVertex3f(grid_size * grid_step, 0, 0)
    
    # Z axis
    glColor3f(0.2, 0.2, 0.7)
    glVertex3f(0, 0, -grid_size * grid_step)
    glVertex3f(0, 0, grid_size * grid_step)
    
    # Y axis
    glColor3f(0.2, 0.7, 0.2)
    glVertex3f(0, 0, 0)
    glVertex3f(0, grid_size * grid_step * 0.5, 0)  # Half height for Y axis
    
    glEnd()
    
    glEnable(GL_LIGHTING)  # Turn lighting back on

def draw_controller_state(font_surface, left_x, left_y, right_x, right_y, button_states):
    """Draw controller state on a 2D overlay - only joystick circles"""
    # Position for the controller display
    start_x, start_y = 70, 70
    
    # Semi-transparent background for controller display
    pygame.draw.rect(font_surface, (30, 30, 30, 150), (start_x - 30, start_y - 30, 160, 60), 0, 10)
    
    # Left stick
    pygame.draw.circle(font_surface, PG_GRAY + (200,), (start_x, start_y), 20)
    pygame.draw.circle(font_surface, PG_BLUE + (220,), 
                      (start_x + int(left_x * 15), start_y + int(left_y * 15)), 8)
    
    # Right stick
    pygame.draw.circle(font_surface, PG_GRAY + (200,), (start_x + 70, start_y), 20)
    pygame.draw.circle(font_surface, PG_GREEN + (220,), 
                      (start_x + 70 + int(right_x * 15), start_y + int(right_y * 15)), 8)

def render_text_to_screen(surface):
    """Render the 2D overlay to the screen"""
    # Convert the text surface to an OpenGL texture
    text_data = pygame.image.tostring(surface, "RGBA", True)
    
    # Save the current matrices
    glMatrixMode(GL_PROJECTION)
    glPushMatrix()
    glLoadIdentity()
    glOrtho(0, WIDTH, HEIGHT, 0, -1, 1)
    
    glMatrixMode(GL_MODELVIEW)
    glPushMatrix()
    glLoadIdentity()
    
    # Disable depth test and lighting for 2D overlay
    glDisable(GL_DEPTH_TEST)
    glDisable(GL_LIGHTING)
    
    # Create a texture and draw it as a quad
    texture = glGenTextures(1)
    glBindTexture(GL_TEXTURE_2D, texture)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, WIDTH, HEIGHT, 0, GL_RGBA, GL_UNSIGNED_BYTE, text_data)
    
    glEnable(GL_TEXTURE_2D)
    glEnable(GL_BLEND)
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
    
    # Draw the texture as a full-screen quad
    glBegin(GL_QUADS)
    glTexCoord2f(0, 0); glVertex2f(0, 0)
    glTexCoord2f(1, 0); glVertex2f(WIDTH, 0)
    glTexCoord2f(1, 1); glVertex2f(WIDTH, HEIGHT)
    glTexCoord2f(0, 1); glVertex2f(0, HEIGHT)
    glEnd()
    
    # Clean up
    glDisable(GL_TEXTURE_2D)
    glDisable(GL_BLEND)
    glDeleteTextures([texture])
    
    # Restore saved matrices and states
    glEnable(GL_DEPTH_TEST)
    glEnable(GL_LIGHTING)
    
    glMatrixMode(GL_PROJECTION)
    glPopMatrix()
    
    glMatrixMode(GL_MODELVIEW)
    glPopMatrix()

# Initialize OpenGL
setup_3d()

# Event loop
running = True
clock = pygame.time.Clock()

while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.KEYDOWN:
            if event.key == pygame.K_ESCAPE:
                running = False
                
        # Mouse handling for orbit controls
        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button == 1:  # Left mouse button
                mouse_pressed = True
                prev_mouse_pos = pygame.mouse.get_pos()
            elif event.button == 4:  # Scroll up
                camera_distance = max(100, camera_distance - 20)
            elif event.button == 5:  # Scroll down
                camera_distance = min(1000, camera_distance + 20)
                
        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1:  # Left mouse button
                mouse_pressed = False
                
        elif event.type == pygame.MOUSEMOTION:
            if mouse_pressed and prev_mouse_pos:
                x, y = pygame.mouse.get_pos()
                dx = x - prev_mouse_pos[0]
                dy = y - prev_mouse_pos[1]
                
                # Update camera rotation based on mouse movement
                camera_rot_y += dx * orbit_sensitivity
                camera_rot_x += dy * orbit_sensitivity
                
                # Limit vertical rotation to avoid gimbal lock
                camera_rot_x = max(-85, min(85, camera_rot_x))
                
                prev_mouse_pos = (x, y)
    
    # Read analog sticks
    left_x = controller.get_axis(0)  # Left joystick X-axis
    left_y = controller.get_axis(1)  # Left joystick Y-axis
    right_x = controller.get_axis(2)  # Right joystick X-axis
    right_y = controller.get_axis(3)  # Right joystick Y-axis

    # Read buttons
    button_pressed = [controller.get_button(i) for i in range(controller.get_numbuttons())]

    # Apply deadzone to prevent drift
    def apply_deadzone(value, deadzone=0.1):
        return 0 if abs(value) < deadzone else value
    
    left_x = apply_deadzone(left_x)
    left_y = apply_deadzone(left_y)
    right_x = apply_deadzone(right_x)
    right_y = apply_deadzone(right_y)
    
    # Update joint angles based on controller input
    speed_factor = 0.03
    
    # Update angles with constraints
    new_angles = joint_angles.copy()
    
    # Left stick controls the first two joints
    new_angles[0] += left_x * speed_factor  # Base rotation (yaw)
    new_angles[1] += left_y * speed_factor  # Shoulder pitch
    
    # Right stick controls the next two joints
    new_angles[2] += right_x * speed_factor  # Elbow pitch
    new_angles[3] += right_y * speed_factor  # Wrist pitch
    
    # Apply angle limits
    for i in range(len(new_angles)):
        new_angles[i] = max(MIN_ANGLE, min(MAX_ANGLE, new_angles[i]))
    
    joint_angles = new_angles
    
    # Clear the screen and depth buffer
    glClearColor(0.07, 0.07, 0.1, 1)  # Dark blue-gray background
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
    
    # Update camera position
    update_camera()
    
    # Draw the 3D scene
    draw_grid()
    draw_robotic_arm()
    
    # Prepare the 2D overlay
    font_surface.fill((0, 0, 0, 0))  # Clear with transparent background
    draw_controller_state(font_surface, left_x, left_y, right_x, right_y, button_pressed)
    
    # Render the 2D overlay
    render_text_to_screen(font_surface)
    
    # Swap the buffers
    pygame.display.flip()
    
    # Cap the frame rate
    clock.tick(60)

# Clean up
pygame.quit()
sys.exit()
