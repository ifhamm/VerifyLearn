const leftSidebars = document.getElementById('left-sidebars');
const toggleLeftBtn = document.getElementById('toggle-left-btn');

// Fungsi buka/tutup Sidebar Kiri (Navigasi & Menu)
toggleLeftBtn.addEventListener('click', () => {
    leftSidebars.classList.toggle('hidden');
});

const dropdownBtn = document.getElementById('toggle-dropdown-btn');
const dropdownMenu = document.getElementById('dropdown-menu');
const dropdownIcon = document.getElementById('dropdown-icon');

dropdownBtn.addEventListener('click', () => {
    // Toggle visibility of the menu
    dropdownMenu.classList.toggle('hidden');
    dropdownMenu.classList.toggle('block');

    // Toggle chevron icon rotation
    dropdownIcon.classList.toggle('rotate-180');
});

const hintBtn = document.getElementById('use-hint-btn');
const hintDisplay = document.getElementById('hint-display');
const hintCounter = document.getElementById('hint-counter');
let hintsLeft = 3;

if (hintBtn) {
    hintBtn.addEventListener('click', () => {
        if (hintsLeft > 0) {
            // Kurangi sisa hint
            hintsLeft--;
            hintCounter.innerText = hintsLeft + " Left";

            // Tampilkan kotak teks hint
            hintDisplay.classList.remove('hidden');

            // Jika hint habis, matikan tombol
            if (hintsLeft === 0) {
                hintBtn.disabled = true;
                hintBtn.classList.remove('text-orange-600', 'border-orange-500', 'hover:bg-orange-50');
                hintBtn.classList.add('text-gray-400', 'border-gray-200', 'bg-gray-50', 'cursor-not-allowed');
                hintBtn.innerText = "No Hints Left";
                hintCounter.classList.remove('text-orange-600', 'bg-orange-50', 'border-orange-100');
                hintCounter.classList.add('text-gray-500', 'bg-gray-100', 'border-gray-200');
            }
        }
    });
}