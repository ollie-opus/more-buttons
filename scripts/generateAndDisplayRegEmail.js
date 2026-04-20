export function generateAndDisplayRegEmail(mode = 'default') {

    const regLink = (() => {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get('link_url');
        return raw ? decodeURIComponent(raw) : '';
    })();


    // Registration Steps renderer

    const renderRegistrationSteps = (regLink) => `
    <!-- Step 1 -->
    <tr>
    <td style="padding:8px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="border-radius:6px; background-color:#f7f8fc; border:1px solid #e3e6f0;">
        <tr>
            <td style="padding:16px 18px 14px;">
            <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.06em;
            text-transform:uppercase; color:#7a8193; font-weight:600;">
                Step 1
            </p>
            <p style="margin:0 0 8px; font-size:16px; font-weight:600; color:#002e72;">
                Create your Opus Account
            </p>
            <p style="margin:0 0 16px; font-size:14px; color:#4a4f5c;">
                Click the button below and select <strong>Sign up</strong> to create your Opus Account.
            </p>

            <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                <td align="left" bgcolor="#002e72" style="border-radius:4px;">
                    <a href="${regLink}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="display:inline-block; padding:8px 16px;
                    font-size:15px; font-weight:600; color:#ffffff;
                    text-decoration:none; border-radius:4px;">
                    Create my Opus Account
                    </a>
                </td>
                </tr>
            </table>

            <p style="margin:12px 0 0; font-size:11px; color:#8b90a0;">
            Or copy and paste this link into your browser:<br />
            <i>
                <a href="${regLink}"
                target="_blank"
                rel="noopener noreferrer"
                style="word-break:break-all;
                font-family:monospace;
                color:#8b90a0;
                text-decoration:none;">
                ${regLink}
                </a>
            </i>
            </p>
            </td>
        </tr>
        </table>
    </td>
    </tr>

    <!-- Step 2 -->
    <tr>
    <td style="padding:16px 32px 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="border-radius:6px; background-color:#f7f8fc; border:1px solid #e3e6f0;">
        <tr>
            <td style="padding:16px 18px 14px;">
            <p style="margin:0 0 4px; font-size:12px; letter-spacing:0.06em;
            text-transform:uppercase; color:#7a8193; font-weight:600;">
                Step 2
            </p>
            <p style="margin:0 0 8px; font-size:16px; font-weight:600; color:#002e72;">
                Link your account to your employee record
            </p>
            <p style="margin:0 0 6px; font-size:14px; color:#4a4f5c;">
                After signing up, you'll be taken to a confirmation page.
            </p>
            <p style="margin:0 0 10px; font-size:14px; color:#4a4f5c;">
            Confirm that the details on the page are correct, then click
            <strong>Link my Opus Account</strong> to connect your Opus Account to your employee record.
            </p>
            </td>
        </tr>
        </table>
    </td>
    </tr>

    <!-- Divider -->
    <tr>
    <td style="padding:16px 32px 0;">
        <hr style="border:none; border-top:1px solid #e3e6f0; margin:0;" />
    </td>
    </tr>
    `;


    // Card Renderer

    const renderCard = ({
        title,
        description,
        buttonTitle,
        buttonUrl,
        smallText
    }) => {
        if (!title) return '';

        return `
        <tr>
        <td style="padding:0 32px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="border-radius:6px; border:1px solid #e3e6f0; margin-bottom:8px;">
            <tr>
                <td style="padding:14px 18px;">
                <p style="margin:0 0 4px; font-size:16px; font-weight:600; color:#002e72;">
                    ${title}
                </p>
                <p style="margin:0 0 ${buttonUrl || smallText ? '12px' : '0'}; font-size:13px; color:#4a4f5c;">
                    ${description || ''}
                </p>

                ${buttonUrl ? `
                <table cellpadding="0" cellspacing="0" border="0">
                    <tr>
                    <td align="left" style="border-radius:4px; border:1px solid #002e72;">
                        <a href="${buttonUrl}" target="_blank" rel="noopener noreferrer"
                        style="display:inline-block; padding:8px 16px; font-size:15px; font-weight:600;
                        color:#002e72; text-decoration:none; border-radius:4px;">
                        ${buttonTitle}
                        </a>
                    </td>
                    </tr>
                </table>
                ` : ''}

                ${smallText ? `
                <p style="margin:${buttonUrl ? '8px' : '0'} 0 0; font-size:11px; color:#8b90a0;">
                    ${smallText}
                </p>
                ` : ''}

                </td>
            </tr>
            </table>
        </td>
        </tr>
        `;
    };

    // HTML Generator

    const getHtmlMessage = (uuid) => {

        let intro;
        let cards = [];

        if (mode === 'seed') {

            intro = `Your Opus Consultant has published an audit for you to review.
            <strong>Please complete the steps below to set up your account:</strong>`;

            cards = [
                {
                    title: `📃 View your audit reports`,
                    description: `Access your audit report(s) for your site(s) at any time by clicking the button below.`,
                    buttonTitle: `Your audit reports`,
                    buttonUrl: `https://cloud.opus-safety.co.uk/admin/sites/${uuid}/compliance-reports`,
                    smallText: `<strong>Tip:</strong> bookmark this webpage for quick future access.`
                },
                {
                    title: `🔔 Audit email notifications <span style="font-size:12px; font-weight:400; color:#7a8193;">(recommended)</span>`,
                    description: `Configure to receive an email whenever a new audit is published for your site(s).`,
                    buttonTitle: `Your notification settings`,
                    buttonUrl: `https://cloud.opus-safety.co.uk/sites/${uuid}/todos?todo_subscriptions#system/audit_review-email-severity`,
                    smallText: `Via the button above, select <strong>"Always"</strong> in the blue highlighted dropdown, then click <strong>"Save changes"</strong>.`
                },
                {
                    title: `💡 Knowledge Base & support`,
                    description: `Find how-to articles, FAQs and guidance on using Opus Compliance Cloud.`,
                    buttonTitle: `Open Knowledge Base`,
                    buttonUrl: `https://sites.google.com/opus-safety.co.uk/opus-help/home`,
                    smallText: `You can also access the Knowledge Base from within OCC by clicking your profile icon in the top-right corner and selecting <strong>Support</strong>.`
                },
                {
                    title: `✅ Make the most of Opus Compliance Cloud`,
                    description: `If you're interested in discovering the full capabilities of Opus Compliance Cloud, please contact your Opus consultant.`
                }
            ];

        } else {

            intro = `Please complete the steps below to set up your account:`;

            cards = [
                {
                    title: `💻 My Dashboard`,
                    description: `Access your sites, complete your own e-learning / checklists, and much more.`,
                    buttonTitle: `Open My Dashboard`,
                    buttonUrl: `https://cloud.opus-safety.co.uk/dashboard`,
                    smallText: `<strong>Tip:</strong> bookmark this webpage for quick future access.`
                },
                {
                    title: `📺 Training Videos`,
                    description: `New to Opus Compliance Cloud? Learn how to use the software here.`,
                    buttonTitle: `View Training Videos`,
                    buttonUrl: `https://sites.google.com/opus-safety.co.uk/opus-help/introduction/training-videos`,
                    smallText: `We <strong>highly recommend</strong> watching these to get up to speed on how to manage effectively on OCC.`
                },
                {
                    title: `🔔 Subscribing to email and In-System Notifications`,
                    description: `Follow this guide to set up notifications for incidents and other events.`,
                    buttonTitle: `Open Notification Guide`,
                    buttonUrl: `https://sites.google.com/opus-safety.co.uk/opus-help/introduction/subscribing-to-notifications-email-in-system`,
                    smallText: `You can also access the Knowledge Base from within OCC by clicking your profile icon in the top-right corner and selecting <strong>Support</strong>.`
                }
            ];
        }

        const renderedCards = cards.map(renderCard).join('');

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8" />
        </head>
        <body style="margin:0; padding:0; background-color:#f5f7fb;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7fb; padding:24px 0;">
        <tr>
        <td align="center">

        <table width="600" cellpadding="0" cellspacing="0" border="0"
        style="background-color:#ffffff; border-radius:8px;
        box-shadow:0 2px 6px rgba(0,0,0,0.04);
        font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        color:#333; line-height:1.5;">

        <!-- Header -->
        <tr>
        <td style="padding:20px 32px 12px; border-bottom:1px solid #e6e9f2;">
            <table width="100%">
            <tr>
                <td>
                <img src="https://raw.githubusercontent.com/ollie-opus/occ-report-type-resources/refs/heads/main/Opus%20Safety%20logo_RGB%20(2).png"
                alt="Opus Safety"
                style="max-width:100px;" />
                </td>
                <td align="right" style="font-size:12px; color:#7a8193;">
                Opus Compliance Cloud
                </td>
            </tr>
            </table>
        </td>
        </tr>

        <!-- Hero -->
        <tr>
        <td style="padding:24px 32px 8px;">
            <h1 style="margin:0 0 8px; font-size:22px; font-weight:600; color:#002e72;">
            Welcome to Opus Compliance Cloud
            </h1>
            <p style="margin:0 0 12px; font-size:14px; color:#4a4f5c;">
            ${intro}
            </p>
        </td>
        </tr>

        ${renderRegistrationSteps(regLink)}

        <tr>
          <td style="padding:16px 32px 8px;">
            <h2 style="margin:0 0 6px; font-size:18px; font-weight:600; color:#002e72;">
              Your next steps
            </h2>
            <p style="margin:0 0 16px; font-size:14px; color:#4a4f5c;">
              Here are some useful links to help with your <strong>next steps</strong> in Opus Compliance Cloud:
            </p>
          </td>
        </tr>

        ${renderedCards}

        <!-- Footer -->
        <tr>
        <td style="padding:16px 32px 24px; border-top:1px solid #e6e9f2;">
            <p style="margin:0 0 8px; font-size:13px;">
            We're excited to have you using Opus Safety. If you have any questions or feedback, please get in touch with our team.
            </p>
            <p style="margin:0; font-size:13px;">
            Best regards,<br />
            <strong style="color:#002e72;">The Opus Safety Team</strong>
            </p>
        </td>
        </tr>

        </table>
        </td>
        </tr>
        </table>
        </body>
        </html>
        `;
    };

    // Overlay Display Logic

    (async () => {

        let uuid;

        if (mode === 'seed') {

            const dropdownTrigger = document.querySelector('.site-select__current');
            if (!dropdownTrigger) {
                alert('Dropdown trigger not found');
                return;
            }

            dropdownTrigger.click();

            const timeout = 5000;
            const interval = 100;
            const start = Date.now();

            let siteItems = [];

            while (true) {
                siteItems = document.querySelectorAll('.site-index_parent');
                if (siteItems.length > 0) break;
                if (Date.now() - start > timeout) {
                    alert('No UUIDs found (timeout)');
                    return;
                }
                await new Promise(r => setTimeout(r, interval));
            }

            const uuids = Array.from(siteItems)
                .map(item => {
                    const anchor = item.querySelector('a[href^="https://cloud.opus-safety.co.uk/sites/"]');
                    if (!anchor) return null;
                    const match = anchor.href.match(/\/sites\/([a-f0-9\-]{36})/);
                    return match ? match[1] : null;
                })
                .filter(Boolean);

            if (!uuids.length) {
                alert('No UUIDs found');
                return;
            }

            uuid = uuids[0];
        }

        const finalHtml = getHtmlMessage(uuid);

        document.body.style.overflow = 'hidden';

        const overlay = document.createElement('div');
        overlay.style = `
            position:fixed;
            top:0; left:0;
            width:100%; height:100%;
            background:white;
            z-index:8000;
            display:flex;
            justify-content:center;
            padding:60px;
        `;

        const iframe = document.createElement('iframe');
        iframe.style = `
            width:50%;
            height:100%;
            border:1px solid #ccc;
            box-shadow:0 4px 15px rgba(0,0,0,0.2);
            background:white;
        `;

        overlay.appendChild(iframe);
        document.body.appendChild(overlay);

        const iframeDoc = iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(finalHtml);
        iframeDoc.close();
    })();
}
