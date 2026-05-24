#!/usr/bin/env bash
# Start three throwaway Python HTTP servers on ports 3004/3005/3006 to act as
# upstream backends for the nginx reverse-proxy test. Each server replies with
# its own port so we can verify nginx is round-robining across all three.
set -euo pipefail

for port in 3004 3005 3006; do
  python3 -c "
import http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'ok from $port'
        self.send_response(200)
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(('', $port), H)
httpd.serve_forever()
" &
done

sleep 1
echo "Mock upstreams started on 3004, 3005, 3006"
