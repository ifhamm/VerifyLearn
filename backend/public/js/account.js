// public/js/account.js

document.addEventListener('DOMContentLoaded', () => {
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  const loginModal = document.getElementById('loginModal');
  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const metaMaskLoginBtn = document.getElementById('metaMaskLoginBtn');
  const mockLoginBtn = document.getElementById('mockLoginBtn');
  const mockUsernameInput = document.getElementById('mockUsernameInput');
  const startLearningBtn = document.querySelector('a[href="myPath.html"]');

  // Check login state on load
  const sessionToken = localStorage.getItem('sessionToken');
  const walletAddress = localStorage.getItem('walletAddress');
  const username = localStorage.getItem('username');

  if (sessionToken && walletAddress) {
    updateWalletUI(username || walletAddress);
  }

  // --- Modal Toggle ---
  function showModal() {
    if (loginModal) loginModal.classList.remove('hidden');
  }

  function hideModal() {
    if (loginModal) loginModal.classList.add('hidden');
  }

  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', (e) => {
      e.preventDefault();
      
      // If already logged in, click triggers sign out confirmation
      if (localStorage.getItem('sessionToken')) {
        if (confirm('Apakah Anda yakin ingin keluar (Sign Out)?')) {
          logout();
        }
        return;
      }
      
      showModal();
    });
  }

  if (closeLoginModalBtn) {
    closeLoginModalBtn.addEventListener('click', hideModal);
  }

  // Close modal when clicking outside content box
  if (loginModal) {
    loginModal.addEventListener('click', (e) => {
      if (e.target === loginModal) {
        hideModal();
      }
    });
  }

  // --- Real MetaMask Login ---
  if (metaMaskLoginBtn) {
    metaMaskLoginBtn.addEventListener('click', async () => {
      if (window.ethereum) {
        try {
          metaMaskLoginBtn.disabled = true;
          metaMaskLoginBtn.textContent = 'MENGHUBUNGKAN...';

          // Request account
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          const address = accounts[0];

          // Request cryptographic signature to prove ownership
          const timestamp = Date.now();
          const message = `Welcome to VerifyLearn! Please sign this message to verify your wallet ownership. Timestamp: ${timestamp}`;
          
          const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, address]
          });

          // Verify signature on backend
          const response = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              address,
              signature,
              message,
              isMock: false
            })
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Verifikasi login gagal di server.');
          }

          // Save session
          localStorage.setItem('sessionToken', data.token);
          localStorage.setItem('walletAddress', data.walletAddress);
          localStorage.setItem('username', data.username);

          updateWalletUI(data.username);
          hideModal();
          alert('Berhasil masuk menggunakan wallet Web3!');

        } catch (err) {
          console.error('MetaMask connection or signature error:', err);
          alert('Gagal menghubungkan wallet: ' + err.message);
        } finally {
          metaMaskLoginBtn.disabled = false;
          metaMaskLoginBtn.textContent = 'Hubungkan MetaMask';
        }
      } else {
        alert('MetaMask tidak terdeteksi. Silakan gunakan opsi Akun Simulasi di bawah untuk mencoba aplikasi.');
      }
    });
  }

  // --- Simulated Mock Login ---
  if (mockLoginBtn) {
    mockLoginBtn.addEventListener('click', async () => {
      const usernameVal = mockUsernameInput ? mockUsernameInput.value.trim() : '';
      if (!usernameVal) {
        alert('Silakan masukkan nama/username simulasi Anda terlebih dahulu.');
        return;
      }

      try {
        mockLoginBtn.disabled = true;
        mockLoginBtn.textContent = 'MASUK...';

        const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
        
        // Call backend login with mock configuration
        const response = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: mockAddress,
            signature: 'mock-signature',
            username: usernameVal,
            isMock: true
          })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Login simulasi gagal.');
        }

        // Save session
        localStorage.setItem('sessionToken', data.token);
        localStorage.setItem('walletAddress', data.walletAddress);
        localStorage.setItem('username', data.username);

        updateWalletUI(data.username);
        hideModal();
        alert(`Selamat datang, ${data.username}! Anda masuk menggunakan Akun Simulasi.`);

      } catch (err) {
        console.error('Mock login error:', err);
        alert('Gagal login simulasi: ' + err.message);
      } finally {
        mockLoginBtn.disabled = false;
        mockLoginBtn.textContent = 'Masuk dengan Akun Simulasi';
      }
    });
  }

  // --- Start Learning Button Guard ---
  if (startLearningBtn) {
    startLearningBtn.addEventListener('click', (e) => {
      const token = localStorage.getItem('sessionToken');
      if (!token) {
        e.preventDefault();
        alert('Silakan masuk (Sign In) terlebih dahulu menggunakan wallet Web3 atau Akun Simulasi untuk mulai belajar.');
        showModal();
      }
    });
  }

  // --- Logout function ---
  async function logout() {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
      } catch (err) {
        console.error('Logout API error:', err);
      }
    }

    // Clear local storage session
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('walletAddress');
    localStorage.removeItem('username');

    // Reset button UI
    if (connectWalletBtn) {
      connectWalletBtn.textContent = 'SIGN IN';
      connectWalletBtn.classList.remove('bg-brandOrange');
      connectWalletBtn.classList.add('bg-white', 'text-textMain');
    }
    alert('Anda telah keluar (Signed Out).');
  }

  // --- UI Updates ---
  function updateWalletUI(name) {
    if (connectWalletBtn) {
      // Display truncated address if it looks like an address, otherwise display name
      const displayVal = name.startsWith('0x') && name.length > 12 
        ? `${name.slice(0, 6)}...${name.slice(-4)}`
        : name;

      connectWalletBtn.textContent = displayVal.toUpperCase();
      connectWalletBtn.classList.remove('bg-white', 'text-textMain');
      connectWalletBtn.classList.add('bg-brandOrange', 'text-white');
    }
  }
});
