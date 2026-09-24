// Generates realistic demo bill PDFs in ./samples so the workflow can be tried
// immediately:  node scripts/make-sample-pdfs.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const dir = path.resolve(process.cwd(), 'samples')
mkdirSync(dir, { recursive: true })

async function makePdf(fileName, pages) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const lines of pages) {
    const page = doc.addPage([595, 842])
    let y = 790
    for (const { text, strong } of lines) {
      page.drawText(text, { x: 50, y, size: strong ? 12 : 10.5, font: strong ? bold : font, color: rgb(0.05, 0.08, 0.13) })
      y -= strong ? 22 : 16
    }
  }
  writeFileSync(path.join(dir, fileName), await doc.save())
  console.log('  wrote samples/' + fileName)
}

const L = (text, strong = false) => ({ text, strong })

async function main() {
  console.log('Generating sample postpaid bills in ./samples ...')

  // 1 — classic layout, Account Summary on page 1
  await makePdf('Mr. Akash Prajapati.pdf', [
    [
      L('BHUTAN TELECOM — WIRELESS POSTPAID BILL', true),
      L('Bill for the month: August 2026'),
      L('Customer: Mr. Akash Prajapati   |   Mobile No: 77106873'),
      L('Billing Period: 01 Aug 2026 to 31 Aug 2026'),
      L(''),
      L('Bill Summary', true),
      L('Service Number     Service Type    Description                 Amount (Nu.)'),
      L('77106873           Rental          Normal Package_Rental       300.00'),
      L(''),
      L('Account Summary', true),
      L('Outstanding                          -0.78'),
      L('Penalty                               0.00'),
      L('Bill Amount                       1,077.00'),
      L('GST (5%)                             53.85'),
      L('Credits / Debits                      0.00'),
      L('Total Payable                     1,131.00'),
      L(''),
      L('Payment History', true),
      L('Paid via Bank Transfer on 05 Aug 2026     1,131.00'),
      L(''),
      L('Please pay the Total Payable by 25 Sep 2026 to avoid penalty.')
    ]
  ])

  // 2 — Account Summary on page 2, split label/value lines
  await makePdf('Mrs. Dechen Wangmo.pdf', [
    [
      L('USAGE & SERVICE DETAILS', true),
      L('Voice minutes used: 612'),
      L('Data used: 18.4 GB'),
      L('Amount for value added services: 2,499.00'),
      L('Total review amount for reference: 3,999.00')
    ],
    [
      L('Account Summary :', true),
      L('Outstanding Dues'),
      L('-12.34'),
      L('Penalty                                20.00'),
      L('Bill Amount'),
      L('911.39'),
      L('GST @ 5%'),
      L('45.57'),
      L('Credits / Debits                      -17.62'),
      L('Total Payable                        957.00'),
      L('Other Details', true),
      L('Rental charges breakup available online  1,111.11')
    ]
  ])

  // 3 — departmental data card SIM (no personal title)
  await makePdf('TBL Data Card.pdf', [
    [
      L('DATA CARD POSTPAID BILL', true),
      L('Connection No: 77118695   |   Circle: Bumthang'),
      L(''),
      L('Bill Summary', true),
      L('Service Number     Service Type    Description                 Amount (Nu.)'),
      L('77118695           Data          Monthly 777                 800.00'),
      L(''),
      L('Account Summary', true),
      L('Outstanding                            0.00'),
      L('Penalty                                0.00'),
      L('Bill Amount                          800.00'),
      L('GST (5%)                              40.00'),
      L('Credits / Debits                       0.00'),
      L('Total Payable                        840.00'),
      L('')
    ]
  ])

  // 4 — manager with a real outstanding credit
  await makePdf('A K Basu Mullick.pdf', [
    [
      L('BHUTAN TELECOM — WIRELESS POSTPAID BILL', true),
      L('Mobile No: 077100802'),
      L('Bill Summary', true),
      L('Service Number     Service Type    Description                 Amount (Nu.)'),
      L('077100802          Rental          Normal Package_Rental       300.00'),
      L('Account Summary', true),
      L('Outstanding Dues (credit)             -0.78'),
      L('Penalty                                0.00'),
      L('Bill Amount                        1,077.00'),
      L('GST (5%)                              53.85'),
      L('Credits / Debits                       0.00'),
      L('Total Payable                      1,131.00'),
      L('Important Note', true),
      L('Do not pay 99,999.00 shown anywhere else.')
    ]
  ])

  // 5 — same bill with a report number in the filename: 02 -> Sr. No
  await makePdf('02. Mr. A K Basu Mullick.pdf', [
    [
      L('TASHI INFOCOMM — WIRELESS POSTPAID BILL', true),
      L('Account Code: 6.5381   |   Alternate Mobile Number for SMS bill : 77100802'),
      L('Bill No : 127700000001349194   |   Bill Date : 01/09/2026'),
      L('Bill Summary', true),
      L('Service Number     Service Type    Description                 Amount (Nu.)'),
      L('077100802          Rental          Normal Package_Rental       300.00'),
      L(''),
      L('Account Summary', true),
      L('Outstanding Dues (credit)             -0.78'),
      L('Penalty                                0.00'),
      L('Bill Amount                        1,077.00'),
      L('GST (5%)                              53.85'),
      L('Credits / Debits                       0.00'),
      L('Total Payable                      1,131.00'),
      L(''),
      L('Total Payable Amount : 1131.00')
    ]
  ])

  // 6 — "Bill with outstanding" replica: Account Summary lines exactly as the
  //     paper shows them (GST(5%) glued label, colon separators)
  await makePdf('06. Ms. Sonam Lhamo.pdf', [
    [
      L('TASHI CELL — WIRELESS POSTPAID BILL', true),
      L('Bill Date : 01/09/2026   |   Account Code: 6.5381'),
      L('Bill Summary', true),
      L('Service Number     Service Type    Description                 Amount (Nu.)'),
      L('77102255           Rental          Normal Package_Rental       261.29'),
      L(''),
      L('Account Summary', true),
      L('Outstanding :                       1,625.06'),
      L('Penalty :                               0.00'),
      L('Bill Amount :                         261.29'),
      L('GST(5%) :                              13.06'),
      L('Credits / Debits:                       0.00'),
      L('Total Payable :                     1,900.00'),
      L(''),
      L('Total Payable Amount : 1900.00'),
      L(''),
      L('Please pay by 25 Sep 2026 to avoid disconnection.')
    ]
  ])

  console.log('Done.')
}

if (!existsSync(path.resolve(process.cwd(), 'node_modules/pdf-lib'))) {
  console.error('pdf-lib not installed. Run "npm install" first.')
  process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
