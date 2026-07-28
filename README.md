# Manager.io WhatsApp Invoice Extension

Ye static HTML/CSS/JavaScript extension Manager.io ke **Sales Invoice View** se current invoice context leti hai, invoice preview dikhati hai, customer ka WhatsApp number detect karti hai, aur pre-filled WhatsApp message open karti hai.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `.nojekyll`

## GitHub Pages Setup

1. GitHub par naya repository banayein, misal: `manager-wa-extension`.
2. Is folder ki sari files repository ke root mein upload karein.
3. Repository mein `Settings` kholein.
4. Left side `Pages` kholein.
5. `Source` mein `Deploy from a branch` select karein.
6. Branch `main` aur folder `/(root)` select karke Save karein.
7. GitHub Pages ka live address aam tor par ye hoga:

   `https://USERNAME.github.io/manager-wa-extension/`

8. `Enforce HTTPS` enabled rakhein.

## Manager.io Custom Button

- **Name:** WhatsApp Invoice
- **Source:** Url
- **Endpoint:** Agar Manager.io field ke left mein `https://` pehle se laga raha ho to sirf:

  `USERNAME.github.io/manager-wa-extension/`

- **Placement:** `sales-invoice-view`
- **Inactive:** unchecked

Phir `Update` karein, kisi Sales Invoice ko open karein aur **WhatsApp Invoice** button test karein.

## Customer WhatsApp Number

Best result ke liye Customer custom field ka naam in mein se koi rakhein:

- `WhatsApp Number`
- `WhatsApp`
- `Mobile Number`
- `Phone Number`

Number format:

`923001234567`

Extension `03001234567` ko bhi automatically `923001234567` mein convert kar deti hai.

## Important Limitation

Normal `wa.me` link customer ki chat aur pre-filled message open karta hai, lekin PDF ko automatically attach nahi karta. Extension ka **Print / Save PDF** button use karke PDF save karein aur WhatsApp mein manually attach karein.

Fully automatic PDF sending ke liye WhatsApp Business Platform/API aur secure backend required hoga.
