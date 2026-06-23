const fs = require('fs');
let content = fs.readFileSync('Frontend/index.html', 'utf8');

// 1. Scroll lock
content = content.replace(
  '<div x-data="{ waitlistModal: false }" @open-waitlist.window="waitlistModal = true"',
  '<div x-data="{ waitlistModal: false }" x-init="$watch(\'waitlistModal\', value => document.body.style.overflow = value ? \'hidden\' : \'\')" @open-waitlist.window="waitlistModal = true"'
);

// 2. Toast
content = content.replace(
  `alert('Application submitted successfully!');`,
  `$dispatch('show-toast', 'Application submitted successfully!');`
);

if (!content.includes('x-show="showToast"')) {
    content = content.replace(
      '</body>',
      `<div x-data="{ showToast: false, message: '' }" 
     @show-toast.window="message = $event.detail; showToast = true; setTimeout(() => showToast = false, 3000)"
     class="fixed bottom-6 right-6 z-[999999]"
     x-cloak>
    <div x-show="showToast" 
         x-transition:enter="transition ease-out duration-300"
         x-transition:enter-start="opacity-0 translate-y-4"
         x-transition:enter-end="opacity-100 translate-y-0"
         x-transition:leave="transition ease-in duration-200"
         x-transition:leave-start="opacity-100 translate-y-0"
         x-transition:leave-end="opacity-0 translate-y-4"
         class="bg-zinc-900 border border-green-500/30 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4">
         <div class="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
             <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
         </div>
         <div>
             <h4 class="font-bold text-sm">Success!</h4>
             <p class="text-xs text-zinc-400" x-text="message"></p>
         </div>
    </div>
</div>

</body>`
    );
}

// 3. X (formerly Twitter)
content = content.replace(
  '<span class="text-xs font-medium">Twitter / X</span>',
  '<span class="text-xs font-medium">X (formerly Twitter)</span>'
);

// 4. Beta check
content = content.replace(
  'name="interested_in_beta" value="true" checked class="',
  'name="interested_in_beta" value="true" class="'
);

// 5. Checkboxes alignment & accent
content = content.replace(
  /items-center space-x-3 text-zinc-400 text-sm cursor-pointer/g,
  'items-start space-x-3 text-zinc-400 text-sm cursor-pointer'
);

content = content.replace(
  /class="w-5 h-5 rounded border-zinc-700 bg-white\/5 text-orange-500 focus:ring-orange-500"/g,
  'class="w-5 h-5 mt-0.5 rounded border-zinc-700 bg-white/5 accent-orange-500 focus:ring-2 focus:ring-orange-500"'
);

// Beta checkbox alignment
content = content.replace(
  '<label class="flex items-center space-x-3 text-zinc-400 text-sm cursor-pointer px-2">',
  '<label class="flex items-start space-x-3 text-zinc-400 text-sm cursor-pointer px-2">'
);
content = content.replace(
  'name="interested_in_beta" value="true" class="w-4 h-4 rounded',
  'name="interested_in_beta" value="true" class="w-4 h-4 mt-0.5 rounded accent-orange-500'
);

// 6. Carets on Dropdowns
const svgCaret = `<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-500"><svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></div>`;
content = content.replace(/<select([^>]*class="[^"]*appearance-none[^"]*"[^>]*)>/g, '<div class="relative"><select$1>');
content = content.replace(/<\/select>/g, '</select>' + svgCaret + '</div>');

fs.writeFileSync('Frontend/index.html', content);
console.log("Done");
