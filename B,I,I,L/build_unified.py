import subprocess
import shutil
import os
import sys

def build():
    print("Starting unified build process...")
    
    # Terminate running instances to release locks
    for name in ["LogisticsBillingSuite.exe", "LogisticsDocumentGenerator.exe"]:
        print(f"Checking and terminating running instances of {name}...")
        try:
            subprocess.run(["taskkill", "/F", "/IM", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
            
    script_path = "unified_generator.py"
    exe_name = "LogisticsBillingSuite"
    
    # Check source file
    if not os.path.exists(script_path):
        print(f"Error: {script_path} not found.")
        sys.exit(1)
        
    # Check template files
    templates = [
        "BL INSTRUCTION CPS 001_template.xlsx",
        "AWB Instructions_template.xlsx"
    ]
    for temp in templates:
        if not os.path.exists(temp):
            print(f"Warning: Template file {temp} not found locally! Bundling might fail.")
            
    # PyInstaller compilation command
    # Syntax for --add-data: "source;dest"
    cmd = [
        "pyinstaller",
        "--noconfirm",
        "--onefile",
        "--windowed",
        f"--name={exe_name}",
        "--add-data=BL INSTRUCTION CPS 001_template.xlsx;.",
        "--add-data=AWB Instructions_template.xlsx;.",
        "--exclude-module=sqlalchemy",
        "--exclude-module=torch",
        "--exclude-module=tensorflow",
        "--exclude-module=cv2",
        "--exclude-module=sklearn",
        "--exclude-module=matplotlib",
        "--exclude-module=numba",
        "--exclude-module=bitsandbytes",
        "--exclude-module=scipy",
        "--exclude-module=pandas",
        "--exclude-module=pyarrow",
        "--exclude-module=llvmlite",
        "--exclude-module=jedi",
        "--exclude-module=IPython",
        "--clean",
        script_path
    ]
    
    print(f"Running command: {' '.join(cmd)}")
    
    try:
        subprocess.run(cmd, check=True)
        print("PyInstaller compilation completed successfully!")
    except subprocess.CalledProcessError as e:
        print("Error during compilation:", e)
        sys.exit(1)
        
    # Move the output executable to the current directory
    dist_exe = os.path.join("dist", f"{exe_name}.exe")
    target_exe = f"{exe_name}.exe"
    alternate_exe = "LogisticsDocumentGenerator.exe"
    
    if os.path.exists(dist_exe):
        print(f"Moving compiled executable to: {os.path.abspath(target_exe)}")
        try:
            if os.path.exists(target_exe):
                os.remove(target_exe)
            shutil.move(dist_exe, target_exe)
        except PermissionError:
            print("\n" + "!"*50)
            print("PERMISSION ERROR: Could not overwrite LogisticsBillingSuite.exe!")
            print("The application is likely running in the background. Please close the app and run the build again.")
            print(f"Meanwhile, your new executable is saved at: {os.path.abspath(dist_exe)}")
            print("!"*50 + "\n")
            sys.exit(1)
            
        # Copy the new executable to the old executable name (LogisticsDocumentGenerator.exe)
        print(f"Copying compiled executable to: {os.path.abspath(alternate_exe)}")
        try:
            if os.path.exists(alternate_exe):
                os.remove(alternate_exe)
            shutil.copy2(target_exe, alternate_exe)
        except PermissionError:
            print("\n" + "!"*50)
            print("PERMISSION ERROR: Could not overwrite LogisticsDocumentGenerator.exe!")
            print("The application is likely running in the background.")
            print("!"*50 + "\n")
    else:
        print("Error: Compiled executable not found in dist folder.")
        sys.exit(1)
        
    # Clean up temporary directories
    print("Cleaning up temporary build directories...")
    if os.path.exists("build"):
        shutil.rmtree("build")
    if os.path.exists("dist"):
        shutil.rmtree("dist")
        
    spec_file = f"{exe_name}.spec"
    if os.path.exists(spec_file):
        os.remove(spec_file)
        
    print("\n" + "="*40)
    print("BUILD SUCCESSFUL!")
    print(f"Standalone executable created at: {os.path.abspath(target_exe)}")
    print("="*40)

if __name__ == "__main__":
    build()
