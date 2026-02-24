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
  detailedLog: [],
  pendingApprovals: [],
  rmaField: {
    hubspot: 'rma_number',
    monday: 'text_mknfeq16'
  },
  fieldMappings: [
    { hubspotField: 'content', mondayColumn: 'text', label: 'Description', sourceOfTruth: 'hubspot' },
    { hubspotField: 'hs_pipeline_stage', mondayColumn: 'status', label: 'Status', sourceOfTruth: 'monday' },
    { hubspotField: 'hs_ticket_priority', mondayColumn: 'priority', label: 'Priority', sourceOfTruth: 'monday' }
  ],
  mondayColumns: [],
  hubspotProperties: []
};

const syncState = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

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

function logDetailed(syncTime, direction, action, itemName, details, status) {
  const detailedEntry = {
    syncTime: syncTime,
    direction: direction,
    action: action,
    itemName: itemName,
    details: details,
    status: status,
    timestamp: new Date().toISOString()
  };
  config.detailedLog.unshift(detailedEntry);
  if (config.detailedLog.length > 200) config.detailedLog.pop();
}

function addToPendingApprovals(direction, itemName, rmaNumber, data, reason) {
  const approval = {
    id: generateId(),
    direction: direction,
    itemName: itemName,
    rmaNumber: rmaNumber,
    data: data,
    reason: reason,
    timestamp: new Date().toISOString()
  };
  config.pendingApprovals.push(approval);
  logSync('Added to approval queue: ' + itemName + ' (RMA: ' + rmaNumber + ')', 'info');
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
    const allProps = 'subject,' + propertyList + ',' + config.rmaField.hubspot + ',hubspot_owner_id';
    
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

async function createHubSpotTicket(data) {
  try {
    const properties = { subject: data.subject };
    
    if (data.rma_number) {
      properties[config.rmaField.hubspot] = data.rma_number;
    }
    
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
  
  if (ticketData.rma_number && config.rmaField.monday) {
    columnValues[config.rmaField.monday] = ticketData.rma_number;
  }
  
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

async function syncHubSpotToMonday() {
  if (!config.syncEnabled) return;
  
  try {
    const syncTime = new Date().toISOString();
    logSync('Starting HubSpot to Monday.com sync...', 'info');
    const tickets = await getHubSpotTickets();
    const mondayItems = await getMondayItems();
    
    const mondayMap = new Map();
    mondayItems.forEach(function(item) {
      const rmaCol = item.column_values.find(function(c) {
        return c.id === config.rmaField.monday;
      });
      if (rmaCol && rmaCol.text) {
        mondayMap.set(rmaCol.text, item);
      }
    });
    
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let pending = 0;
    let failed = 0;
    
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const rmaNumber = ticket.properties[config.rmaField.hubspot];
      const ticketData = { 
        subject: ticket.properties.subject,
        rma_number: rmaNumber
      };
      
      const fieldDetails = [];
      config.fieldMappings.forEach(function(mapping) {
        if (ticket.properties[mapping.hubspotField]) {
          ticketData[mapping.hubspotField] = ticket.properties[mapping.hubspotField];
          fieldDetails.push(mapping.label + ': ' + ticket.properties[mapping.hubspotField]);
        }
      });
      
      if (!rmaNumber) {
        skipped++;
        logDetailed(syncTime, 'HubSpot → Monday', 'Skipped', ticketData.subject, 'No RMA number', 'info');
        continue;
      }
      
      const existingItem = mondayMap.get(rmaNumber);
      
      try {
        if (!existingItem) {
          const alreadyPending = config.pendingApprovals.find(function(p) {
            return p.rmaNumber === rmaNumber && p.direction === 'hubspot_to_monday';
          });
          
          if (!alreadyPending) {
            addToPendingApprovals(
              'hubspot_to_monday',
              ticketData.subject,
              rmaNumber,
              ticketData,
              'No matching RMA in Monday'
            );
            pending++;
            logDetailed(syncTime, 'HubSpot → Monday', 'Pending Approval', ticketData.subject, 'RMA: ' + rmaNumber + ', Added to approval queue', 'info');
          } else {
            skipped++;
            logDetailed(syncTime, 'HubSpot → Monday', 'Already Pending', ticketData.subject, 'RMA: ' + rmaNumber + ', Already in approval queue', 'info');
          }
        } else {
          const updateData = {};
          const updatedFields = [];
          
          config.fieldMappings.forEach(function(mapping) {
            const shouldSync = mapping.sourceOfTruth === 'hubspot' || mapping.sourceOfTruth === 'both';
            if (shouldSync && ticketData[mapping.hubspotField] !== undefined) {
              updateData[mapping.hubspotField] = ticketData[mapping.hubspotField];
              updatedFields.push(mapping.label);
            }
          });
          
          if (Object.keys(updateData).length > 0) {
            await updateMondayItem(existingItem.id, updateData);
            updated++;
            logDetailed(syncTime, 'HubSpot → Monday', 'Updated', ticketData.subject, 'RMA: ' + rmaNumber + ', Fields: ' + updatedFields.join(', '), 'success');
          } else {
            skipped++;
            logDetailed(syncTime, 'HubSpot → Monday', 'Skipped', ticketData.subject, 'RMA: ' + rmaNumber + ', No fields to sync (source of truth rules)', 'info');
          }
        }
      } catch (error) {
        failed++;
        logSync('Failed to sync ticket: ' + ticketData.subject, 'error');
        logDetailed(syncTime, 'HubSpot → Monday', 'Failed', ticketData.subject, 'RMA: ' + rmaNumber + ', Error: ' + error.message, 'error');
      }
    }
    
    logSync('HubSpot to Monday sync complete: ' + created + ' created, ' + updated + ' updated, ' + pending + ' pending approval, ' + skipped + ' skipped, ' + failed + ' failed', failed > 0 ? 'error' : 'success');
    config.lastSync = new Date().toISOString();
  } catch (error) {
    logSync('Sync failed: ' + error.message, 'error');
  }
}

async function syncMondayToHubSpot() {
  if (!config.syncEnabled) return;
  
  try {
    const syncTime = new Date().toISOString();
    logSync('Starting Monday.com to HubSpot sync...', 'info');
    const mondayItems = await getMondayItems();
    const hubspotTickets = await getHubSpotTickets();
    
    const hubspotMap = new Map();
    hubspotTickets.forEach(function(ticket) {
      const rmaNumber = ticket.properties[config.rmaField.hubspot];
      if (rmaNumber) {
        hubspotMap.set(rmaNumber, ticket);
      }
    });
    
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let pending = 0;
    let failed = 0;
    
    for (let i = 0; i < mondayItems.length; i++) {
      const item = mondayItems[i];
      const itemData = { subject: item.name };
      
      const rmaCol = item.column_values.find(function(c) {
        return c.id === config.rmaField.monday;
      });
      const rmaNumber = rmaCol ? rmaCol.text : null;
      
      if (rmaNumber) {
        itemData.rma_number = rmaNumber;
      }
      
      const fieldDetails = [];
      config.fieldMappings.forEach(function(mapping) {
        const col = item.column_values.find(function(c) {
          return c.id === mapping.mondayColumn;
        });
        if (col && col.text) {
          itemData[mapping.mondayColumn] = col.text;
          fieldDetails.push(mapping.label + ': ' + col.text);
        }
      });
      
      if (!rmaNumber) {
        skipped++;
        logDetailed(syncTime, 'Monday → HubSpot', 'Skipped', itemData.subject, 'No RMA number', 'info');
        continue;
      }
      
      const existingTicket = hubspotMap.get(rmaNumber);
      
      try {
        if (!existingTicket) {
          const alreadyPending = config.pendingApprovals.find(function(p) {
            return p.rmaNumber === rmaNumber && p.direction === 'monday_to_hubspot';
          });
          
          if (!alreadyPending) {
            addToPendingApprovals(
              'monday_to_hubspot',
              itemData.subject,
              rmaNumber,
              itemData,
              'No matching RMA in HubSpot'
            );
            pending++;
            logDetailed(syncTime, 'Monday → HubSpot', 'Pending Approval', itemData.subject, 'RMA: ' + rmaNumber + ', Added to approval queue', 'info');
          } else {
            skipped++;
            logDetailed(syncTime, 'Monday → HubSpot', 'Already Pending', itemData.subject, 'RMA: ' + rmaNumber + ', Already in approval queue', 'info');
          }
        } else {
          const updateData = {};
          const updatedFields = [];
          
          config.fieldMappings.forEach(function(mapping) {
            const shouldSync = mapping.sourceOfTruth === 'monday' || mapping.sourceOfTruth === 'both';
            if (shouldSync && itemData[mapping.mondayColumn] !== undefined) {
              updateData[mapping.mondayColumn] = itemData[mapping.mondayColumn];
              updatedFields.push(mapping.label);
            }
          });
          
          if (Object.keys(updateData).length > 0) {
            await updateHubSpotTicket(existingTicket.id, updateData);
            updated++;
            logDetailed(syncTime, 'Monday → HubSpot', 'Updated', itemData.subject, 'RMA: ' + rmaNumber + ', Fields: ' + updatedFields.join(', '), 'success');
          } else {
            skipped++;
            logDetailed(syncTime, 'Monday → HubSpot', 'Skipped', itemData.subject, 'RMA: ' + rmaNumber + ', No fields to sync (source of truth rules)', 'info');
          }
        }
      } catch (error) {
        failed++;
        logSync('Failed to sync item: ' + itemData.subject, 'error');
        logDetailed(syncTime, 'Monday → HubSpot', 'Failed', itemData.subject, 'RMA: ' + rmaNumber + ', Error: ' + error.message, 'error');
      }
    }
    
    logSync('Monday to HubSpot sync complete: ' + created + ' created, ' + updated + ' updated, ' + pending + ' pending approval, ' + skipped + ' skipped, ' + failed + ' failed', failed > 0 ? 'error' : 'success');
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
  const pendingCount = config.pendingApprovals.length;
  const pendingBadge = pendingCount > 0 ? '<span class="badge-warning">Pending Approvals: ' + pendingCount + '</span>' : '';
  
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
  
  let detailedLogHtml = '';
  if (config.detailedLog.length === 0) {
    detailedLogHtml = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">No detailed sync history yet.</td></tr>';
  } else {
    let currentSyncTime = '';
    config.detailedLog.forEach(function(entry) {
      const syncTimeFormatted = new Date(entry.syncTime).toLocaleString();
      const showSyncTime = syncTimeFormatted !== currentSyncTime;
      if (showSyncTime) currentSyncTime = syncTimeFormatted;
      
      const rowClass = entry.status === 'error' ? 'error-row' : entry.status === 'success' ? 'success-row' : 'info-row';
      const actionBadge = entry.action === 'Created' ? 'badge-created' : entry.action === 'Updated' ? 'badge-updated' : entry.action === 'Failed' ? 'badge-failed' : entry.action === 'Pending Approval' ? 'badge-pending' : 'badge-skipped';
      
      detailedLogHtml += '<tr class="' + rowClass + '">';
      detailedLogHtml += '<td>' + (showSyncTime ? '<strong>' + syncTimeFormatted + '</strong>' : '') + '</td>';
      detailedLogHtml += '<td><span class="direction-badge">' + entry.direction + '</span></td>';
      detailedLogHtml += '<td><span class="' + actionBadge + '">' + entry.action + '</span></td>';
      detailedLogHtml += '<td><strong>' + entry.itemName + '</strong></td>';
      detailedLogHtml += '<td>' + entry.details + '</td>';
      detailedLogHtml += '</tr>';
    });
  }
  
  let approvalsHtml = '';
  if (config.pendingApprovals.length === 0) {
    approvalsHtml = '<div style="text-align:center;padding:40px;color:#999;"><h3>No Pending Approvals</h3><p>When new items are detected that don\'t have matching RMA numbers, they\'ll appear here for your approval.</p></div>';
  } else {
    config.pendingApprovals.forEach(function(approval) {
      const directionText = approval.direction === 'hubspot_to_monday' ? 'HubSpot → Monday' : 'Monday → HubSpot';
      const directionClass = approval.direction === 'hubspot_to_monday' ? 'direction-hs-mon' : 'direction-mon-hs';
      
      let fieldsHtml = '';
      for (let key in approval.data) {
        if (key !== 'subject' && key !== 'rma_number' && approval.data[key]) {
          fieldsHtml += '<div><strong>' + key + ':</strong> ' + approval.data[key] + '</div>';
        }
      }
      
      approvalsHtml += '<div class="approval-card">';
      approvalsHtml += '<div class="approval-header">';
      approvalsHtml += '<span class="' + directionClass + '">' + directionText + '</span>';
      approvalsHtml += '<span class="approval-time">' + new Date(approval.timestamp).toLocaleString() + '</span>';
      approvalsHtml += '</div>';
      approvalsHtml += '<div class="approval-body">';
      approvalsHtml += '<h4>' + approval.itemName + '</h4>';
      approvalsHtml += '<div class="approval-rma"><strong>RMA:</strong> ' + approval.rmaNumber + '</div>';
      approvalsHtml += '<div class="approval-reason"><em>' + approval.reason + '</em></div>';
      if (fieldsHtml) {
        approvalsHtml += '<div class="approval-fields"><strong>Fields to sync:</strong>' + fieldsHtml + '</div>';
      }
      approvalsHtml += '</div>';
      approvalsHtml += '<div class="approval-actions">';
      approvalsHtml += '<form action="/approve/' + approval.id + '" method="POST" style="display:inline;">';
      approvalsHtml += '<button type="submit" class="success">✅ Approve & Create</button>';
      approvalsHtml += '</form>';
      approvalsHtml += '<form action="/reject/' + approval.id + '" method="POST" style="display:inline;">';
      approvalsHtml += '<button type="submit" class="danger">❌ Reject</button>';
      approvalsHtml += '</form>';
      approvalsHtml += '</div>';
      approvalsHtml += '</div>';
    });
  }
  
  let fieldMappingsHtml = '';
  config.fieldMappings.forEach(function(mapping, index) {
    const hubspotSelected = mapping.sourceOfTruth === 'hubspot' ? 'selected' : '';
    const mondaySelected = mapping.sourceOfTruth === 'monday' ? 'selected' : '';
    const bothSelected = mapping.sourceOfTruth === 'both' ? 'selected' : '';
    
    fieldMappingsHtml += '<div class="mapping-row" id="mapping-' + index + '">';
    fieldMappingsHtml += '<div class="form-group" style="margin-bottom: 15px;">';
    fieldMappingsHtml += '<div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">';
    fieldMappingsHtml += '<div style="flex: 1;"><label style="margin-bottom: 5px;">HubSpot Field</label><select name="hubspot_' + index + '" id="hubspot_' + index + '" class="hubspot-field-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">';
    fieldMappingsHtml += '<option value="">Select HubSpot Field...</option>';
    if (mapping.hubspotField) {
      fieldMappingsHtml += '<option value="' + mapping.hubspotField + '" selected>' + (mapping.label || mapping.hubspotField) + ' (' + mapping.hubspotField + ')</option>';
    }
    fieldMappingsHtml += '</select></div>';
    fieldMappingsHtml += '<div style="flex: 0 0 50px; text-align: center; font-size: 20px; margin-top: 20px;">→</div>';
    fieldMappingsHtml += '<div style="flex: 1;"><label style="margin-bottom: 5px;">Monday Column</label><select name="monday_' + index + '" id="monday_' + index + '" class="monday-column-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">';
    fieldMappingsHtml += '<option value="">Select Monday Column...</option>';
    if (mapping.mondayColumn) {
      fieldMappingsHtml += '<option value="' + mapping.mondayColumn + '" selected>' + mapping.mondayColumn + '</option>';
    }
    fieldMappingsHtml += '</select></div>';
    fieldMappingsHtml += '</div>';
    fieldMappingsHtml += '<div style="display: flex; gap: 10px; align-items: center;">';
    fieldMappingsHtml += '<div style="flex: 1;"><label style="margin-bottom: 5px;">Source of Truth</label><select name="source_' + index + '" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">';
    fieldMappingsHtml += '<option value="hubspot" ' + hubspotSelected + '>HubSpot (HubSpot → Monday only)</option>';
    fieldMappingsHtml += '<option value="monday" ' + mondaySelected + '>Monday (Monday → HubSpot only)</option>';
    fieldMappingsHtml += '<option value="both" ' + bothSelected + '>Both (sync in both directions)</option>';
    fieldMappingsHtml += '</select></div>';
    fieldMappingsHtml += '<div style="flex: 0 0 auto;"><label style="margin-bottom: 5px; opacity: 0;">Remove</label><button type="button" onclick="removeMapping(' + index + ')" class="danger" style="padding: 10px 15px; display: block;">Remove</button></div>';
    fieldMappingsHtml += '</div></div></div>';
  });
  
  const html = '<!DOCTYPE html><html><head><title>HubSpot Monday.com Sync - Approval Queue</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:1200px;margin:50px auto;padding:20px;background:#f5f5f5}.container{background:white;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}h1{color:#333;margin-bottom:10px}.subtitle{color:#666;margin-bottom:30px}.form-group{margin-bottom:20px}label{display:block;margin-bottom:5px;font-weight:600;color:#333;font-size:13px}input,textarea,select{width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;font-size:14px;box-sizing:border-box}button{background:#0073ea;color:white;border:none;padding:12px 24px;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;margin-right:10px}button:hover{background:#0060c0}.danger{background:#e44258}.danger:hover{background:#c23448}.success{background:#00c875}.success:hover{background:#00a565}.status{padding:15px;border-radius:4px;margin:20px 0}.status.enabled{background:#e6f7ed;border:1px solid #00c875}.status.disabled{background:#fff3e6;border:1px solid #ff9900}.log{background:#f9f9f9;border:1px solid #ddd;border-radius:4px;padding:15px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:12px}.log-entry{margin-bottom:8px;padding:4px}.log-entry.error{color:#e44258}.log-entry.success{color:#00c875}.log-entry.info{color:#333}.help-text{font-size:12px;color:#666;margin-top:5px}.section{margin-top:40px}.mapping-row{border:1px solid #e0e0e0;padding:20px;border-radius:4px;margin-bottom:15px;background:#fafafa}.detailed-log-table{width:100%;border-collapse:collapse;font-size:13px}.detailed-log-table th{background:#f5f5f5;padding:12px 8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;color:#333;position:sticky;top:0}.detailed-log-table td{padding:10px 8px;border-bottom:1px solid #eee}.detailed-log-table tr:hover{background:#f9f9f9}.error-row{background:#fff5f5}.success-row{background:#f0fdf4}.info-row{background:#fafafa}.direction-badge{background:#e8f4fd;color:#0073ea;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-created{background:#dcfce7;color:#16a34a;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-updated{background:#dbeafe;color:#2563eb;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-failed{background:#fee2e2;color:#dc2626;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-skipped{background:#f3f4f6;color:#6b7280;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-pending{background:#fef3c7;color:#d97706;padding:4px 8px;border-radius:3px;font-size:11px;font-weight:600}.badge-warning{background:#fbbf24;color:#fff;padding:8px 16px;border-radius:20px;font-size:14px;font-weight:600;margin-left:15px}.log-container{max-height:600px;overflow-y:auto;border:1px solid #ddd;border-radius:4px}.approval-card{border:2px solid #f59e0b;border-radius:8px;padding:20px;margin-bottom:20px;background:#fffbeb}.approval-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;padding-bottom:10px;border-bottom:1px solid #fde68a}.approval-body h4{margin:0 0 10px 0;font-size:18px;color:#333}.approval-rma{margin:8px 0;padding:8px;background:#fef3c7;border-radius:4px;font-family:monospace}.approval-reason{color:#92400e;font-style:italic;margin:8px 0}.approval-fields{margin-top:15px;padding:10px;background:white;border-radius:4px}.approval-fields div{margin:5px 0}.approval-actions{margin-top:15px;padding-top:15px;border-top:1px solid #fde68a}.direction-hs-mon{background:#dbeafe;color:#1e40af;padding:6px 12px;border-radius:4px;font-weight:600;font-size:12px}.direction-mon-hs{background:#dcfce7;color:#15803d;padding:6px 12px;border-radius:4px;font-weight:600;font-size:12px}.approval-time{color:#78716c;font-size:12px}</style></head><body><div class="container"><h1>HubSpot Monday.com Sync</h1><p class="subtitle">Two-way ticket synchronization with approval queue ' + pendingBadge + '</p><div class="status ' + statusClass + '"><strong>Status:</strong> ' + statusText + lastSyncText + '</div><form action="/config" method="POST"><div class="form-group"><label>HubSpot Access Token</label><input type="password" name="hubspotToken" value="' + config.hubspotToken + '" placeholder="pat-na1-xxxxx..." required><div class="help-text">Get from HubSpot Settings Integrations Private Apps</div></div><div class="form-group"><label>Monday.com API Token</label><input type="password" name="mondayToken" value="' + config.mondayToken + '" placeholder="eyJhbGc..." required><div class="help-text">Get from Monday.com Profile Admin API</div></div><div class="form-group"><label>Monday.com Board ID</label><input type="text" name="mondayBoardId" value="' + config.mondayBoardId + '" placeholder="1234567890" required><div class="help-text">Find in URL when viewing your board</div></div><button type="submit">Save Configuration</button></form><div class="section"><h3>Field Mapping with Source of Truth</h3><p class="help-text">Map fields and choose which platform is the source of truth for each one</p><button onclick="discoverFields()" class="success" style="margin-bottom:20px;">Discover Available Fields</button><span id="discover-status" style="margin-left:10px;color:#666;"></span><div id="field-mapping-container"><form id="mapping-form" action="/field-mapping" method="POST"><div id="mappings-list">' + fieldMappingsHtml + '</div><button type="button" onclick="addMapping()" class="success" style="margin-top:10px;">+ Add Field Mapping</button><br><br><button type="submit">Save Field Mappings</button></form></div></div><div class="section"><h3>Sync Controls</h3><form action="/enable" method="POST" style="display:inline;"><button type="submit" class="success">Enable Auto-Sync</button></form><form action="/disable" method="POST" style="display:inline;"><button type="submit" class="danger">Disable Auto-Sync</button></form><form action="/sync" method="POST" style="display:inline;"><button type="submit">Manual Sync Now</button></form></div><div class="section" id="approvals-section"><h3>📋 Pending Approvals (' + pendingCount + ')</h3><p class="help-text">Review and approve items before they are created. Items with matching RMA numbers update automatically without approval.</p>' + approvalsHtml + '</div><div class="section"><h3>Detailed Sync History</h3><p class="help-text">Complete itemized log of all sync activity</p><div class="log-container"><table class="detailed-log-table"><thead><tr><th style="width:15%">Sync Time</th><th style="width:15%">Direction</th><th style="width:10%">Action</th><th style="width:25%">Item</th><th>Details</th></tr></thead><tbody>' + detailedLogHtml + '</tbody></table></div></div><div class="section"><h3>Summary Log</h3><div class="log">' + logHtml + '</div></div></div><script>var hubspotFields=[];var mondayColumns=[];var currentMappings=' + JSON.stringify(config.fieldMappings) + ';var mappingCounter=' + config.fieldMappings.length + ';async function discoverFields(){var statusEl=document.getElementById("discover-status");statusEl.textContent="Discovering fields...";statusEl.style.color="#0073ea";try{var response=await fetch("/discover-fields");var data=await response.json();if(data.success){statusEl.textContent="Fields discovered!";statusEl.style.color="#00c875";hubspotFields=data.hubspot;mondayColumns=data.monday;populateAllDropdowns();setTimeout(function(){statusEl.textContent=""},3000)}else{statusEl.textContent="Error: "+data.error;statusEl.style.color="#e44258"}}catch(error){statusEl.textContent="Error discovering fields";statusEl.style.color="#e44258"}}function populateAllDropdowns(){document.querySelectorAll(".hubspot-field-select").forEach(function(select,index){populateHubSpotDropdown(select,currentMappings[index]?currentMappings[index].hubspotField:"")});document.querySelectorAll(".monday-column-select").forEach(function(select,index){populateMondayDropdown(select,currentMappings[index]?currentMappings[index].mondayColumn:"")})}function populateHubSpotDropdown(select,currentValue){select.innerHTML="<option value=\\"\\">Select HubSpot Field...</option>";hubspotFields.forEach(function(field){var option=document.createElement("option");option.value=field.name;option.textContent=field.label+" ("+field.name+")";if(field.name===currentValue){option.selected=true}select.appendChild(option)})}function populateMondayDropdown(select,currentValue){select.innerHTML="<option value=\\"\\">Select Monday Column...</option>";mondayColumns.forEach(function(col){var option=document.createElement("option");option.value=col.id;option.textContent=col.title+" ("+col.type+") ["+col.id+"]";if(col.id===currentValue){option.selected=true}select.appendChild(option)})}function addMapping(){var container=document.getElementById("mappings-list");var newRow=document.createElement("div");newRow.className="mapping-row";newRow.id="mapping-"+mappingCounter;var html="<div class=\\"form-group\\" style=\\"margin-bottom:15px;\\">";html+="<div style=\\"display:flex;gap:10px;align-items:center;margin-bottom:10px;\\">";html+="<div style=\\"flex:1;\\"><label style=\\"margin-bottom:5px;\\">HubSpot Field</label><select name=\\"hubspot_"+mappingCounter+"\\" id=\\"hubspot_"+mappingCounter+"\\" class=\\"hubspot-field-select\\" style=\\"width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;\\"><option value=\\"\\">Select HubSpot Field...</option></select></div>";html+="<div style=\\"flex:0 0 50px;text-align:center;font-size:20px;margin-top:20px;\\">→</div>";html+="<div style=\\"flex:1;\\"><label style=\\"margin-bottom:5px;\\">Monday Column</label><select name=\\"monday_"+mappingCounter+"\\" id=\\"monday_"+mappingCounter+"\\" class=\\"monday-column-select\\" style=\\"width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;\\"><option value=\\"\\">Select Monday Column...</option></select></div>";html+="</div>";html+="<div style=\\"display:flex;gap:10px;align-items:center;\\">";html+="<div style=\\"flex:1;\\"><label style=\\"margin-bottom:5px;\\">Source of Truth</label><select name=\\"source_"+mappingCounter+"\\" style=\\"width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;\\"><option value=\\"hubspot\\">HubSpot (HubSpot → Monday only)</option><option value=\\"monday\\" selected>Monday (Monday → HubSpot only)</option><option value=\\"both\\">Both (sync in both directions)</option></select></div>";html+="<div style=\\"flex:0 0 auto;\\"><label style=\\"margin-bottom:5px;opacity:0;\\">Remove</label><button type=\\"button\\" onclick=\\"removeMapping("+mappingCounter+")\\" class=\\"danger\\" style=\\"padding:10px 15px;display:block;\\">Remove</button></div>";html+="</div></div>";newRow.innerHTML=html;container.appendChild(newRow);if(hubspotFields.length>0){populateHubSpotDropdown(document.getElementById("hubspot_"+mappingCounter),"");populateMondayDropdown(document.getElementById("monday_"+mappingCounter),"")}mappingCounter++}function removeMapping(index){var row=document.getElementById("mapping-"+index);if(row){row.remove()}}</script></body></html>';
  
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
      const sourceOfTruth = req.body['source_' + index] || 'both';
      if (hubspotField && mondayColumn) {
        const hubspotProp = config.hubspotProperties.find(function(p) {
          return p.name === hubspotField;
        });
        newMappings.push({
          hubspotField: hubspotField,
          mondayColumn: mondayColumn,
          label: hubspotProp ? hubspotProp.label : hubspotField,
          sourceOfTruth: sourceOfTruth
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

app.post('/approve/:id', async function(req, res) {
  const approvalId = req.params.id;
  const approval = config.pendingApprovals.find(function(a) { return a.id === approvalId; });
  
  if (!approval) {
    logSync('Approval not found: ' + approvalId, 'error');
    res.redirect('/');
    return;
  }
  
  try {
    const syncTime = new Date().toISOString();
    if (approval.direction === 'hubspot_to_monday') {
      await createMondayItem(approval.data);
      logSync('Approved & created Monday item: ' + approval.itemName, 'success');
      logDetailed(syncTime, 'HubSpot → Monday', 'Created (Approved)', approval.itemName, 'RMA: ' + approval.rmaNumber + ', User approved', 'success');
    } else {
      await createHubSpotTicket(approval.data);
      logSync('Approved & created HubSpot ticket: ' + approval.itemName, 'success');
      logDetailed(syncTime, 'Monday → HubSpot', 'Created (Approved)', approval.itemName, 'RMA: ' + approval.rmaNumber + ', User approved', 'success');
    }
    config.pendingApprovals = config.pendingApprovals.filter(function(a) { return a.id !== approvalId; });
  } catch (error) {
    logSync('Error creating approved item: ' + error.message, 'error');
  }
  res.redirect('/');
});

app.post('/reject/:id', function(req, res) {
  const approvalId = req.params.id;
  const approval = config.pendingApprovals.find(function(a) { return a.id === approvalId; });
  
  if (approval) {
    const syncTime = new Date().toISOString();
    const direction = approval.direction === 'hubspot_to_monday' ? 'HubSpot → Monday' : 'Monday → HubSpot';
    logSync('Rejected approval: ' + approval.itemName, 'info');
    logDetailed(syncTime, direction, 'Rejected', approval.itemName, 'RMA: ' + approval.rmaNumber + ', User rejected', 'info');
    config.pendingApprovals = config.pendingApprovals.filter(function(a) { return a.id !== approvalId; });
  }
  res.redirect('/');
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
  if (config.pendingApprovals.length > 0) {
    logSync('Pending approvals: ' + config.pendingApprovals.length + ' items waiting', 'info');
  }
});
