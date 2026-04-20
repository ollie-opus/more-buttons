export function highlightPackageTemplateInMPP () {
    const textToFind = "Package Templates - (for sideloading - Do Not Edit!)";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);

    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue.includes(textToFind)) {
            const span = document.createElement('span');
            span.textContent = textToFind;
            span.style.backgroundColor = '#db2777';
            span.style.color = 'white'; // Make text white
            span.style.padding = '2px';
            span.style.borderRadius = '4px';

            const index = node.nodeValue.indexOf(textToFind);
            const before = document.createTextNode(node.nodeValue.slice(0, index));
            const after = document.createTextNode(node.nodeValue.slice(index + textToFind.length));

            const parent = node.parentNode;
            parent.replaceChild(after, node);
            parent.insertBefore(span, after);
            parent.insertBefore(before, span);

            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
    }
}
