const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let config = {
  hubspotToken: process.env.HUBSPOT_TOKEN || '',
  mondayToken: process.env.MONDAY_TOKEN || '',
  mondayBoardId: process.env.MONDAY_BOARD_ID || '',
  syncEnabled: false,
  lastSync: null,
  syncLog: [],
  fieldRules: {
    title: 'hubspot',
    description: 'hubspot',
    status: 'monday',
    priority: 'monday',
    assignee: 'both'
  },
  fieldMappings: [
    { hubspotField: 'content', mondayColumn: 'text', label: 'Description' },
    { hubspotField: 'hs_pipeline_stage', mondayColumn: 'status', label: 'Status' },
    { hubspotField: 'hs_ticket_priority', mondayColumn: 'priority', label: 'Priority' }
  ],
  mondayColumns: [],
  hubspotProperties: []
};

const syncState = new Map();

function logSync(message, type) {
  if (!type) type = 'info';
  const logEntry = {
    timestamp: new Date().toISOString(),
    message: message,
    type: type
  };
  config.syncLog.unshift(logEntry);
  if (config.syncLog.length > 50) config.syncLog.pop();
  console.log('[' + type.toUpperCase() + '] ' + message);
}

async function fetchHubSpotProperties() {
  try {
    const response = await axios.get('https://api.hubapi.com/crm/v3/properties/tickets', {
      headers: {
        'Authorization': 'Bearer ' + config.hubspotToken,
        'Content-Type': 'application/json'
      }
    });
    
    config.hubspotProperties = response.data.results.map(function(prop) {
      return {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        description: prop.description || ''
      };
    });
    
    return config.hubspotProperties;
  } catch (error) {
    logSync('Error fetching HubSpot properties: ' + error.message, 'error');
    return [];
  }
}

async function fetchMondayColumns() {
  try {
    const query = 'query ($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type settings_str } } }';
    const data = await mondayQuery(query, { boardId: config.mondayBoardId });
    
    if (data.boards && data.boards[0]) {
      config.mondayColumns = data.boards[0].columns.map(function(col) {
        return {
          id: col.id,
          title: col.title,
          type: col.type,
          settings: col.settings_str
        };
      });
    }
    
    return config.mondayColumns;
  } catch (error) {
    logSync('Error fetching Monday columns: ' + error.message, 'error');
    return [];
  }
}

async function getHubSpotTickets() {
  try {
    const propertyList = config.fieldMappings.map(function(m) { return m.hubspotField; }).join(',');
    const allProps = 'subject,' + propertyList + ',hubspot_owner_id,hs_attachment_ids';
    
    const response = await axios.get('https://api.hubapi.com/crm/v3/objects/tickets', {
      headers: {
        'Authorization': 'Bearer ' + config.hubspotToken,
        'Content-Type': 'application/json'
      },
      params: {
        properties: allProps,
        limit: 100
      }
    });
    return response.data.results || [];
  } catch (error) {
    logSync('Error fetching HubSpot tickets: ' + error.message, 'error');
    throw error;
  }
}

async function getHubSpotAttachments(ticketId) {
  try {
    const response = await axios.get('https://api.hubapi.com/crm/v3/objects/tickets/' + ticketId + '/associations/attachment', {
      headers: {
        'Authorization': 'Bearer ' + config.hubspotToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.results && response.data.results.length > 0) {
      const attachmentIds = response.data.results.map(function(a) { return a.id; });
      const attachments = [];
      
      for (let i = 0; i < attachmentIds.length; i++) {
        const attResponse = await axios.get('https://api.hubapi.com/filemanager/api/v3/files/' + attachmentIds[i], {
          headers: {
            'Authorization': 'Bearer ' + config.hubspotToken,
            'Content-Type': 'application/json'
          }
        });
        attachments.push(attResponse.data);
      }
      
      return attachments;
    }
    return [];
  } catch (error) {
    logSync('Error fetching attachments: ' + error.message, 'error');
    return [];
  }
}

async function createHubSpotTicket(data) {
  try {
    const properties = { subject: data.subject };
    
    config.fieldMappings.forEach(function(mapping) {
      if (data[mapping.mondayColumn] !== undefined) {
        properties[mapping.hubspotField] = data[mapping.mondayColumn];
      }
    });
    
    const response = await axios.post('https://api.hubapi.com/crm/v3/objects/tickets', {
      properties: properties
    }, {
      headers: {
        'Authorization': 'Bearer ' + config.hubspotToken,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    logSync('Error creating HubSpot ticket: ' + error.message, 'error');
    throw error;
  }
}

async function updateHubSpotTicket(ticketId, data) {
  try {
    const properties = {};
    if (data.subject !== undefined) properties.subject = data.subject;
    
    config.fieldMappings.forEach(function(mapping) {
      if (data[mapping.mondayColumn] !== undefined) {
        properties[mapping.hubspotField] = data[mapping.mondayColumn];
      }
    });
    
    const response = await axios.patch('https://api.hubapi.com/crm/v3/objects/tickets/' + ticketId, {
      properties: properties
    }, {
      headers: {
        'Authorization': 'Bearer ' + config.hubspotToken,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    logSync('Error updating HubSpot ticket: ' + error.message, 'error');
    throw error;
  }
}

async function mondayQuery(query, variables) {
  try {
    const response = await axios.post('https://api.monday.com/v2', {
      query: query,
      variables: variables
    }, {
      headers: {
        'Authorization': config.mondayToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }
    
    return response.data.data;
  } catch (error) {
    logSync('Monday.com API error: ' + error.message, 'error');
    throw error;
  }
}

async function getMondayItems() {
  const query = 'query ($boardId: ID!) { boards(ids: [$boardId]) { items_page { items { id name column_values { id text value } } } } }';
  const data = await mondayQuery(query, { boardId: config.mondayBoardId });
  return data.boards[0]?.items_page?.items || [];
}

async function createMondayItem(ticketData) {
  const query = 'mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) { create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id } }';
  
  const columnValues = {};
  config.fieldMappings.forEach(function(mapping) {
    if (ticketData[mapping.hubspotField] && mapping.mondayColumn) {
      columnValues[mapping.mondayColumn] = ticketData[mapping.hubspotField];
    }
  });
  
  const data = await mondayQuery(query, {
    boardId: config.mondayBoardId,
    itemName: ticketData.subject,
    columnValues: JSON.stringify(columnValues)
  });
  
  return data.create_item;
}

async function updateMondayItem(itemId, ticketData) {
  const query = 'mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) { change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id } }';
  
  const columnValues = {};
  config.fieldMappings.forEach(function(mapping) {
    if (ticketData[mapping.hubspotField] !== undefined && mapping.mondayColumn) {
      columnValues[mapping.mondayColumn] = ticketData[mapping.hubspotField];
    }
  });
  
  const data = await mondayQuery(query, {
    boardId: config.mondayBoardId,
    itemId: itemId,
    columnValues: JSON.stringify(columnValues)
  });
  
  return data.change_multiple_column_values;
}

async function uploadFileToMonday(itemId, columnId, fileUrl, fileName) {
  try {
    const query = 'mutation ($file: File!, $itemId: ID!, $columnId: String!) { add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id } }';
    
    logSync('Uploading file ' + fileName + ' to Monday item ' + itemId, 'info');
    return true;
  } catch (error) {
    logSync('Error uploading file to Monday: ' + error.message, 'error');
    return false;
  }
}

async function syncHubSpotToMonday() {
  if (!config.syncEnabled) return;
  
  try {
    logSync('Starting HubSpot to Monday.com sync...', 'info');
    const tickets = await getHubSpotTickets();
    const mondayItems = await getMondayItems();
    
    const mondayMap = new Map();
    mondayItems.forEach(function(item) {
      mondayMap.set(item.name, item);
    });
    
    let created = 0;
    let updated = 0;
    
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const ticketData = { subject: ticket.properties.subject };
      
      config.fieldMappings.forEach(function(mapping) {
        if (ticket.properties[mapping.hubspotField]) {
          ticketData[mapping.hubspotField] = ticket.properties[mapping.hubspotField];
        }
      });
      
      const existingItem = mondayMap.get(ticketData.subject);
      
      if (!existingItem) {
        await createMondayItem(ticketData);
        created++;
        logSync('Created Monday item: ' + ticketData.subject, 'success');
      } else {
        const shouldUpdate = config.fieldMappings.some(function(mapping) {
          const rule = config.fieldRules[mapping.label.toLowerCase()] || 'both';
          return rule === 'hubspot' || rule === 'both';
        });
        
        if (shouldUpdate) {
          await updateMondayItem(existingItem.id, ticketData);
          updated++;
        }
      }
    }
    
    logSync('HubSpot to Monday sync complete: ' + created + ' created, ' + updated + ' updated', 'success');
    config.lastSync = new Date().toISOString();
  } catch (error) {
    logSync('Sync failed: ' + error.message, 'error');
  }
}

async function syncMondayToHubSpot() {
  if (!config.syncEnabled) return;
  
  try {
    logSync('Starting Monday.com to HubSpot sync...', 'info');
    const mondayItems = await getMondayItems();
    const hubspotTickets = await getHubSpotTickets();
    
    const hubspotMap = new Map();
    hubspotTickets.forEach(function(ticket) {
      hubspotMap.set(ticket.properties.subject, ticket);
    });
    
    let created = 0;
    let updated = 0;
    
    for (let i = 0; i < mondayItems.length; i++) {
      const item = mondayItems[i];
      const itemData = { subject: item.name };
      
      config.fieldMappings.forEach(function(mapping) {
        const col = item.column_values.find(function(c) {
          return c.id === mapping.mondayColumn;
        });
        if (col && col.text) {
          itemData[mapping.mondayColumn] = col.text;
        }
      });
      
      const existingTicket = hubspotMap.get(itemData.subject);
      
      if (!existingTicket) {
        await createHubSpotTicket(itemData);
        created++;
        logSync('Created HubSpot ticket: ' + itemData.subject, 'success');
      } else {
        const shouldUpdate = config.fieldMappings.some(function(mapping) {
          const rule = config.fieldRules[mapping.label.toLowerCase()] || 'both';
          return rule === 'monday' || rule === 'both';
        });
        
        if (shouldUpdate) {
          await updateHubSpotTicket(existingTicket.id, itemData);
          updated++;
        }
      }
    }
    
    logSync('Monday to HubSpot sync complete: ' + created + ' created, ' + updated + ' updated', 'success');
    config.lastSync = new Date().toISOString();
  } catch (error) {
    logSync('Sync failed: ' + error.message, 'error');
  }
}

async function performFullSync() {
  await syncHubSpotToMonday();
  await syncMondayToHubSpot();
}


app.get('/', function(req, res) {
  const statusClass = config.syncEnabled ? 'enabled' : 'disabled';
  const statusText = config.syncEnabled ? 'Sync Enabled' : 'Sync Disabled';
  const lastSyncText = config.lastSync ? '<br><small>Last sync: ' + new Date(config.lastSync).toLocaleString() + '</small>' : '';
  
  let logHtml = '';
  if (config.syncLog.length === 0) {
    logHtml = '<div>No sync activity yet...</div>';
  } else {
    config.syncLog.forEach(function(entry) {
      logHtml += '<div class="log-entry ' + entry.type + '">';
      logHtml += '[' + new Date(entry.timestamp).toLocaleTimeString() + '] ' + entry.message;
      logHtml += '</div>';
    });
  }
  
  let fieldMappingsHtml = '';
  config.fieldMappings.forEach(function(mapping, index) {
    fieldMappingsHtml += '<div class="mapping-row" id="mapping-' + index + '">';
    fieldMappingsHtml += '<div class="form-group" style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">';
    fieldMappingsHtml += '<div style="flex: 1;"><select name="hubspot_' + index + '" id="hubspot_' + index + '" class="hubspot-field-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">';
    fieldMappingsHtml += '<option value="">Select HubSpot Field...</option>';
    fieldMappingsHtml += '</select></div>';
    fieldMappingsHtml += '<div style="flex: 0 0 50px; text-align: center; font-size: 20px;">→</div>';
    fieldMappingsHtml += '<div style="flex: 1;"><select name="monday_' + index + '" id="monday_' + index + '" class="monday-column-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">';
    fieldMappingsHtml += '<option value="">Select Monday Column...</option>';
    fieldMappingsHtml += '</select></div>';
    fieldMappingsHtml += '<button type="button" onclick="removeMapping(' + index + ')" class="danger" style="padding: 10px 15px;">Remove</button>';
    fieldMappingsHtml += '</div></div>';
  });
  
  const html = '<!DOCTYPE html><html><head><title>HubSpot Monday.com Sync</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1000px;margin:50px auto;padding:20px;background:#f5f5f5}.container{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}h1{color:#333;margin-bottom:10px}.subtitle{color:#666;margin-bottom:30px}.form-group{margin-bottom:20px}label{display:block;margin-bottom:5px;font-weight:600;color:#333}input,textarea,select{width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box}button{background:#0073ea;color:white;border:none;padding:12px 24px;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;margin-right:10px}button:hover{background:#0060c0}.danger{background:#e44258}.danger:hover{background:#c23448}.success{background:#00c875}.success:hover{background:#00a565}.status{padding:15px;border-radius:4px;margin:20px 0}.status.enabled{background:#e6f7ed;border:1px solid #00c875}.status.disabled{background:#fff3e6;border:1px solid #ff9900}.log{background:#f9f9f9;border:1px solid #ddd;border-radius:4px;padding:15px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px}.log-entry{margin-bottom:8px;padding:4px}.log-entry.error{color:#e44258}.log-entry.success{color:#00c875}.log-entry.info{color:#333}.help-text{font-size:12px;color:#666;margin-top:5px}.section{margin-top:40px}.mapping-row{border:1px solid #e0e0e0;padding:15px;border-radius:4px;margin-bottom:10px;background:#fafafa}</style></head><body><div class="container"><h1>HubSpot Monday.com Sync</h1><p class="subtitle">Two-way ticket synchronization with dynamic field mapping</p><div class="status ' + statusClass + '"><strong>Status:</strong> ' + statusText + lastSyncText + '</div><form action="/config" method="POST"><div class="form-group"><label>HubSpot Access Token</label><input type="password" name="hubspotToken" value="' + config.hubspotToken + '" placeholder="pat-na1-xxxxx..." required><div class="help-text">Get from HubSpot Settings Integrations Private Apps</div></div><div class="form-group"><label>Monday.com API Token</label><input type="password" name="mondayToken" value="' + config.mondayToken + '" placeholder="eyJhbGc..." required><div class="help-text">Get from Monday.com Profile Admin API</div></div><div class="form-group"><label>Monday.com Board ID</label><input type="text" name="mondayBoardId" value="' + config.mondayBoardId + '" placeholder="1234567890" required><div class="help-text">Find in URL when viewing your board</div></div><button type="submit">Save Configuration</button></form><div class="section"><h3>Field Mapping</h3><p class="help-text">Map HubSpot ticket fields to Monday.com board columns - add as many as you need!</p><button onclick="discoverFields()" class="success" style="margin-bottom:20px;">Discover Available Fields</button><span id="discover-status" style="margin-left:10px;color:#666;"></span><div id="field-mapping-container"><form id="mapping-form" action="/field-mapping" method="POST"><div id="mappings-list">' + fieldMappingsHtml + '</div><button type="button" onclick="addMapping()" class="success" style="margin-top:10px;">+ Add Field Mapping</button><br><br><button type="submit">Save Field Mappings</button></form></div></div><div class="section"><h3>Sync Controls</h3><form action="/enable" method="POST" style="display:inline;"><button type="submit" class="success">Enable Auto-Sync</button></form><form action="/disable" method="POST" style="display:inline;"><button type="submit" class="danger">Disable Auto-Sync</button></form><form action="/sync" method="POST" style="display:inline;"><button type="submit">Manual Sync Now</button></form></div><div class="section"><h3>Sync Log</h3><div class="log">' + logHtml + '</div></div></div><script>var hubspotFields=[];var mondayColumns=[];var currentMappings=' + JSON.stringify(config.fieldMappings) + ';var mappingCounter=' + config.fieldMappings.length + ';setTimeout(function(){location.reload()},30000);async function discoverFields(){var statusEl=document.getElementById("discover-status");statusEl.textContent="Discovering fields...";statusEl.style.color="#0073ea";try{var response=await fetch("/discover-fields");var data=await response.json();if(data.success){statusEl.textContent="Fields discovered!";statusEl.style.color="#00c875";hubspotFields=data.hubspot;mondayColumns=data.monday;populateAllDropdowns();setTimeout(function(){statusEl.textContent=""},3000)}else{statusEl.textContent="Error: "+data.error;statusEl.style.color="#e44258"}}catch(error){statusEl.textContent="Error discovering fields";statusEl.style.color="#e44258"}}function populateAllDropdowns(){document.querySelectorAll(".hubspot-field-select").forEach(function(select,index){populateHubSpotDropdown(select,currentMappings[index]?currentMappings[index].hubspotField:"")});document.querySelectorAll(".monday-column-select").forEach(function(select,index){populateMondayDropdown(select,currentMappings[index]?currentMappings[index].mondayColumn:"")})}function populateHubSpotDropdown(select,currentValue){select.innerHTML="<option value=\\"\\">Select HubSpot Field...</option>";hubspotFields.forEach(function(field){var option=document.createElement("option");option.value=field.name;option.textContent=field.label+" ("+field.name+")";if(field.name===currentValue){option.selected=true}select.appendChild(option)})}function populateMondayDropdown(select,currentValue){select.innerHTML="<option value=\\"\\">Select Monday Column...</option>";mondayColumns.forEach(function(col){var option=document.createElement("option");option.value=col.id;option.textContent=col.title+" ("+col.type+") ["+col.id+"]";if(col.id===currentValue){option.selected=true}select.appendChild(option)})}function addMapping(){var container=document.getElementById("mappings-list");var newRow=document.createElement("div");newRow.className="mapping-row";newRow.id="mapping-"+mappingCounter;var html="<div class=\\"form-group\\" style=\\"display:flex;gap:10px;align-items:center;margin-bottom:15px;\\">";html+="<div style=\\"flex:1;\\"><select name=\\"hubspot_"+mappingCounter+"\\" id=\\"hubspot_"+mappingCounter+"\\" class=\\"hubspot-field-select\\" style=\\"width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;\\"><option value=\\"\\">Select HubSpot Field...</option></select></div>";html+="<div style=\\"flex:0 0 50px;text-align:center;font-size:20px;\\">→</div>";html+="<div style=\\"flex:1;\\"><select name=\\"monday_"+mappingCounter+"\\" id=\\"monday_"+mappingCounter+"\\" class=\\"monday-column-select\\" style=\\"width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;\\"><option value=\\"\\">Select Monday Column...</option></select></div>";html+="<button type=\\"button\\" onclick=\\"removeMapping("+mappingCounter+")\\" class=\\"danger\\" style=\\"padding:10px 15px;\\">Remove</button>";html+="</div>";newRow.innerHTML=html;container.appendChild(newRow);if(hubspotFields.length>0){populateHubSpotDropdown(document.getElementById("hubspot_"+mappingCounter),"");populateMondayDropdown(document.getElementById("monday_"+mappingCounter),"")}mappingCounter++}function removeMapping(index){var row=document.getElementById("mapping-"+index);if(row){row.remove()}}window.addEventListener("load",function(){if("' + config.hubspotToken + '"&&"' + config.mondayToken + '"&&"' + config.mondayBoardId + '"){setTimeout(function(){discoverFields()},1000)}});</script></body></html>';
  
  res.send(html);
});

app.post('/config', function(req, res) {
  config.hubspotToken = req.body.hubspotToken;
  config.mondayToken = req.body.mondayToken;
  config.mondayBoardId = req.body.mondayBoardId;
  logSync('Configuration updated', 'info');
  res.redirect('/');
});

app.get('/discover-fields', async function(req, res) {
  try {
    logSync('Discovering available fields from HubSpot and Monday...', 'info');
    
    const hubspotProps = await fetchHubSpotProperties();
    const mondayColumns = await fetchMondayColumns();
    
    res.json({
      success: true,
      hubspot: hubspotProps,
      monday: mondayColumns,
      currentMappings: config.fieldMappings
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

app.post('/field-mapping', function(req, res) {
  try {
    const newMappings = [];
    let index = 0;
    
    while (req.body['hubspot_' + index] !== undefined) {
      const hubspotField = req.body['hubspot_' + index];
      const mondayColumn = req.body['monday_' + index];
      
      if (hubspotField && mondayColumn) {
        const hubspotProp = config.hubspotProperties.find(function(p) {
          return p.name === hubspotField;
        });
        
        newMappings.push({
          hubspotField: hubspotField,
          mondayColumn: mondayColumn,
          label: hubspotProp ? hubspotProp.label : hubspotField
        });
      }
      index++;
    }
    
    config.fieldMappings = newMappings;
    logSync('Field mappings updated: ' + newMappings.length + ' mappings saved', 'success');
    res.redirect('/');
  } catch (error) {
    logSync('Error updating field mapping: ' + error.message, 'error');
    res.redirect('/');
  }
});

app.post('/enable', function(req, res) {
  config.syncEnabled = true;
  logSync('Auto-sync enabled', 'success');
  res.redirect('/');
});

app.post('/disable', function(req, res) {
  config.syncEnabled = false;
  logSync('Auto-sync disabled', 'info');
  res.redirect('/');
});

app.post('/sync', async function(req, res) {
  logSync('Manual sync triggered', 'info');
  performFullSync();
  res.redirect('/');
});

cron.schedule('*/5 * * * *', function() {
  if (config.syncEnabled) {
    logSync('Scheduled sync starting...', 'info');
    performFullSync();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  logSync('Server started successfully', 'success');
});
