import os
import sys
import webview
import http.server
import socketserver
import threading

PORT = 24689

def start_local_server(directory, port):
    """Spins up a lightweight local HTTP server to host the web app assets"""
    os.chdir(directory)
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *args: None
    
    # Allow port reuse to prevent 'Address already in use' errors on quick restarts
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", port), handler) as httpd:
            httpd.serve_forever()
    except Exception as e:
        print(f"Server thread exception: {e}")

def get_build_directory():
    """Gets the path to the dist directory containing the built HTML/JS/CSS"""
    if getattr(sys, 'frozen', False):
        # Running inside PyInstaller standalone EXE
        base_dir = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    else:
        # Running in development mode
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
    return os.path.join(base_dir, 'dist')

class Api:
    def log_message(self, message):
        print(f"JS LOG: {message}")
        sys.stdout.flush()
        
    def log_error(self, error_json):
        print(f"JS EXCEPTION CAPTURED: {error_json}", file=sys.stderr)
        sys.stderr.flush()

    def save_pdf(self, filename, base64_data):
        try:
            import base64
            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]
            pdf_bytes = base64.b64decode(base64_data)
            
            active_window = webview.active_window()
            if not active_window:
                return False
                
            file_paths = active_window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=('Portable Document Format (*.pdf)', 'All files (*.*)')
            )
            
            if file_paths:
                file_path = file_paths[0]
                with open(file_path, 'wb') as f:
                    f.write(pdf_bytes)
                print(f"PDF saved successfully to: {file_path}")
                sys.stdout.flush()
                return True
            else:
                print("PDF save cancelled by user")
                sys.stdout.flush()
                return False
        except Exception as e:
            print(f"Error saving PDF in Python: {e}", file=sys.stderr)
            sys.stderr.flush()
            return False


if __name__ == '__main__':
    dist_dir = get_build_directory()
    
    if not os.path.exists(dist_dir):
        print(f"Error: Build directory '{dist_dir}' does not exist. Please run npm run build first.")
        sys.exit(1)
        
    # Start the local HTTP server in a background thread
    server_thread = threading.Thread(
        target=start_local_server, 
        args=(dist_dir, PORT), 
        daemon=True
    )
    server_thread.start()
    
    # Create the api instance
    js_api = Api()
    
    import time
    timestamp = int(time.time())
    
    # Create the native app window and point it to the local HTTP server
    # We add a cache-busting timestamp parameter to prevent Edge WebView2 from caching old assets
    webview.create_window(
        title='3D Load & Stuffing Visualizer',
        url=f'http://localhost:{PORT}/?t={timestamp}',
        js_api=js_api,
        width=1280,
        height=820,
        resizable=True,
        min_size=(1024, 768)
    )
    
    # Disable WebView2's native download UI to prevent duplicate save dialog prompts
    is_frozen = getattr(sys, 'frozen', False)
    webview.settings['ALLOW_DOWNLOADS'] = False
    webview.start(debug=not is_frozen)
