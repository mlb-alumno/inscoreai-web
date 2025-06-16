const peer = new Peer();
        
        peer.on('open', function(id) {
            document.getElementById('yourPeerId').textContent = id;
            document.getElementById('peerIdDisplay').classList.remove('hidden');
        });

        document.getElementById('connectPeer').addEventListener('click', function() {
            const peerId = document.getElementById('peerIdInput').value.trim();
            if (peerId) {
                // Store peer ID and redirect to main app
                localStorage.setItem('connectToPeer', peerId);
                window.location.href = 'app.html';
            }
        });

        document.getElementById('startSolo').addEventListener('click', function() {
            window.location.href = 'app.html';
        });