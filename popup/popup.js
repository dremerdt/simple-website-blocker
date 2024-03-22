// Description: This file contains the logic for the popup.html page.
document.addEventListener('DOMContentLoaded', function () {
  var blockButton = document.getElementById('blockButton');
  var unlockButton = document.getElementById('unblockButton');
  var clearAllBlocked = document.getElementById('clearAllBlocked');
  var showBlockedButton = document.getElementById('showBlockedButton');

  blockButton.addEventListener('click', function () {
    var websiteUrl = document.getElementById('websiteUrl').value;
    chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
      var blockedWebsites = data.blockedWebsites;
      blockedWebsites.push(websiteUrl);
      chrome.storage.local.set({ blockedWebsites: blockedWebsites }, function () {
        showInfoWebsiteBlocked(true);
      });
    });
  });

  unlockButton.addEventListener('click', function () {
    var websiteUrl = document.getElementById('websiteUrl').value;
    unblockWebsite(websiteUrl, function () {
      hideInfoWebsiteBlocked(true);
    });
  });

  clearAllBlocked.addEventListener('click', function () {
    chrome.storage.local.set({ blockedWebsites: [] }, function () {
      alert('Blocked websites cleared!');
      hideInfoWebsiteBlocked(true);
      toggleWebsitesList(false);
    });
  });

  showBlockedButton.addEventListener('click', function () {
    chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
      let blockedWebsites = data.blockedWebsites;
      let blockedWebsitesList = document.getElementById('blockedWebsitesList');
      blockedWebsitesList.innerHTML = '';
      for (const site of blockedWebsites) {
        let li = document.createElement('li');
        li.style.listStyleType = 'none';
        let deleteButton = document.createElement('button');
        deleteButton.style.marginRight = '10px';
        deleteButton.appendChild(document.createTextNode('x'));
        deleteButton.addEventListener('click', function () {
          unblockWebsite(site, function () {
            li.remove();
            let currentWebsiteUrl = document.getElementById('websiteUrl').value;
            if (currentWebsiteUrl === site)
              refreshActiveTab();
          });
        });
        li.appendChild(deleteButton);
        li.appendChild(document.createTextNode(site));
        blockedWebsitesList.appendChild(li);
      }
      toggleWebsitesList();
    });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    // since only one tab should be active and in the current window at once
    // the return variable should only have one entry
    let activeTab = tabs[0];
    let hostname = '';
    if (activeTab.url.includes('http') || activeTab.url.includes('https')) {
      hostname = new URL(activeTab.url).hostname;
      document.getElementById('websiteUrl').value = hostname;
    }

    chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
      var blockedWebsites = data.blockedWebsites;
      if (blockedWebsites.some(site => site.includes(hostname))) {
        showInfoWebsiteBlocked();
      } else {
        hideInfoWebsiteBlocked();
      }
    });
  });
});

function unblockWebsite(websiteUrl, callback) {
  chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
    var blockedWebsites = data.blockedWebsites;
    var index = blockedWebsites.indexOf(websiteUrl);
    if (index > -1) {
      blockedWebsites.splice(index, 1);
      chrome.storage.local.set({ blockedWebsites: blockedWebsites }, function () {
        callback();
      });
    }
  });
}

function showInfoWebsiteBlocked(refresh = false) {
  var blockButton = document.getElementById('blockButton');
  var blockedWebsitesInfo = document.getElementById('pWebsiteIsBlocked');

  blockedWebsitesInfo.innerText = 'This website is already blocked!';
  blockedWebsitesInfo.style.display = 'block';
  blockButton.disabled = true;
  // refresh the current tab
  if (refresh) {
    refreshActiveTab();
  }
}

function hideInfoWebsiteBlocked(refresh = false) {
  var blockButton = document.getElementById('blockButton');
  var blockedWebsitesInfo = document.getElementById('pWebsiteIsBlocked');

  blockedWebsitesInfo.style.display = 'none';
  blockButton.disabled = false;
  // refresh the current tab
  if (refresh) {
    refreshActiveTab();
  }
}

function toggleWebsitesList(show) {
  var blockedWebsites = document.getElementById('blockedWebsites');
  var showBlockedButton = document.getElementById('showBlockedButton');
  show = show === undefined ? blockedWebsites.style.display === 'none' : show;
  if (show) {
    blockedWebsites.style.display = 'block';
    showBlockedButton.innerText = 'Hide Blocked';
    return true;
  }

  blockedWebsites.style.display = 'none';
  showBlockedButton.innerText = 'Show Blocked';
  return false;
}

function refreshActiveTab() {
  setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.update(tabs[0].id, { url: tabs[0].url });
    });
  }, 1000); // delay 1s
}