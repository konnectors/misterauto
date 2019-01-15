process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://12a934d948e84706b886845e07352747@sentry.cozycloud.cc/93'

const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  json: false,
  jar: true
})
const formatDate = require('date-fns/format')

const baseUrl = 'https://www.mister-auto.com/moncompte/'

module.exports = new BaseKonnector(start)

async function start(fields) {
  log('info', 'Authenticating ...')
  let $ = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  log('info', 'Fetching the list of documents')
  $ = await request(`${baseUrl}commandes.html`)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    identifiers: ['mister auto'],
    keys: ['id']
  })
}

function authenticate(username, password) {
  return signin({
    requestInstance: request,
    url: baseUrl,
    formSelector: '#login_form',
    formData: {
      'personnelle[email]': username,
      'personnelle[password]': password
    }
  })
}

function parseDocuments($) {
  const orders = $('tr', 'tbody').toArray()

  // Orders which need normal scraping
  const normalOrders = scrape(
    $,
    {
      id: 'td:nth-child(2)',
      amount: {
        sel: 'td:nth-child(3)',
        parse: normalizePrice
      },
      date: {
        sel: 'td:nth-child(1)',
        parse: parseDate
      },
      fileurl: {
        sel: 'td:nth-child(6) a',
        attr: 'href'
      },
    }, '#cmd_table tbody tr:has(> td[rowspan])'
  )

  var preParsedOrders = parseTable(orders, $)  // to retreive a list of orders and groups of orders
  var parsedOrders = [] // list of future parsed orders

  // Orders of a group which need an other type of scrapping
  preParsedOrders.map(item => {
    if (item.groupDate != null) { // we works only with orders which are in a group
      // For each order in the group
      item.rows.map(order => {
        // Scrape it 
        const groupOrders = scrape(
          $(order),
          {
            id: 'td:nth-child(1)',
            amount: {
              sel: 'td:nth-child(2)',
              parse: normalizePrice
            },
            fileurl: {
              sel: 'td:nth-child(5) a',
              attr: 'href'
            }
          }
        )
        groupOrders.date = parseDate(item.groupDate)
        parsedOrders.push(groupOrders)
      })
    }
  })

  parsedOrders = parsedOrders.concat(normalOrders)

  return parsedOrders.map(doc => ({
    ...doc,
    currency: '€',
    vendor: 'Mister Auto',
    filename: formatFileName(doc),
    metadata: {
      importDate: new Date(),
      version: 1
    }
  }))
}

/**
 * @return parsedRows: list of rows and groups of rows
 */
function parseTable(rows, $) {
  var parsedRows = []

  // For each order
  for (let index = 0; index < rows.length; index++) {
    // Retreive first <td>
    const firstTd = $(rows[index]).children().first()
    var groupSize = firstTd.attr('rowspan')

    if (groupSize == 1)
      groupSize = null

    // If first <td> has an attribut rowspan : it's a group
    if (groupSize != null) {
      // This first <td> with rowspan contain the date of a group of order
      const groupDate = firstTd.text()
      // So this order must be parsed normally
      parsedRows.push(rows[index])
      parsedRows.push({ groupDate: groupDate, rows: [] }) // create the group with it's date

      // For each order in the group
      for (let i = index + 1; i < groupSize; i++) {
        parsedRows[parsedRows.length - 1].rows.push(rows[i]) // add it to it's group
      }
      index = index + groupSize - 1
    }
    else { // A normal order not inside a group
      parsedRows.push(rows[index])
    }
  }
  return parsedRows
}

function normalizePrice(price) {
  return parseFloat(price.replace('€', '').trim())
}

function parseDate(date) {
  let [day, time] = date.split(' ')
  time = time.replace('h', ':')
  day = day.split('/').reverse()
  const year = day.shift()
  day.push(year)
  day = day.join('/')
  return new Date(`${day} ${time}`)
}

function formatFileName(doc) {
  return `misterauto-${formatDate(doc.date, 'YYYY-MM-DD')}-${String(
    doc.amount
  ).replace('.', ',')}€.pdf`
}
