export function employeeRecordAccessEditEnhancement() {
    const section = document.querySelector('section[aria-labelledby="site-access-section-title"]');

    if (section) {
        const table = section.querySelector('table');
        if (!table) {
            console.warn('Table not found inside the target section.');
            return;
        }

        // Get the base "edit" link in the header
        const headerEditLink = section.querySelector('header a.button.--primary[href*="/access/edit"]');
        if (!headerEditLink) {
            console.warn('Edit link not found in section header.');
            return;
        }

        const baseUrl = new URL(headerEditLink.href);

        // For each row in the table body
        const tbodyRows = table.querySelectorAll('tbody tr');
        tbodyRows.forEach(row => {
            const firstCell = row.querySelector('td');
            const secondCell = row.querySelectorAll('td')[1];
            const link = firstCell ? firstCell.querySelector('a') : null;

            if (link && secondCell) {
                // Extract UUID from first cell link
                const uuidRegex = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
                const match = link.href.match(uuidRegex);
                const rowUUID = match ? match[1] : null;

                if (!rowUUID) {
                    console.warn('UUID not found in link href:', link.href);
                    return;
                }

                // Replace the contents of the second cell with a button
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.title = 'More Buttons Enhancement'
                btn.className = 'access-link-btn';
                btn.textContent = secondCell.textContent.trim();
                btn.style.background = 'none';
                btn.style.border = 'none';
                btn.style.padding = 0;
                btn.style.color = '#db2777';
                btn.style.cursor = 'pointer';
                btn.style.textDecoration = 'underline';

                // Add click event
                btn.addEventListener('click', () => {
                    const newUrl = new URL(baseUrl.href);
                    newUrl.searchParams.set('focus', rowUUID);
                    const finalUrl = newUrl.toString() + '#site-access-section-title';
                    window.location.href = finalUrl;
                });

                // Replace cell contents with the button
                secondCell.textContent = '';
                secondCell.appendChild(btn);
            }
        });
    }
}
