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
      blockedWebsites.push({
        hostname: websiteUrl,
        status: WEBISTE_BLOCK_STATUS.ACTIVE,
        type: WEBISTE_BLOCK_TYPE.PERMANENT
      });
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
        let deleteButton = getDeleteButton(site.hostname, li);
        let playPauseButton = getPlayPauseButton(site, li);
        li.appendChild(deleteButton);
        li.appendChild(playPauseButton);
        li.appendChild(document.createTextNode(site.hostname));
        blockedWebsitesList.appendChild(li);
      }
      toggleWebsitesList();
    });
  });

  getDeleteButton = function (websiteUrl, li) {
    let deleteButton = document.createElement('button');
    deleteButton.style.marginRight = '2px';
    deleteButton.title = 'Delete';
    deleteButton.appendChild(document.createTextNode('x'));
    deleteButton.addEventListener('click', function () {
      unblockWebsite(websiteUrl, function () {
        li.remove();
        let currentWebsiteUrl = document.getElementById('websiteUrl').value;
        if (currentWebsiteUrl === websiteUrl)
          refreshActiveTab();
      });
    });
    return deleteButton;
  }

  getPlayPauseButton = function (site, li) {
    let playPauseButton = document.createElement('button');
    playPauseButton.style.marginRight = '10px';
    if (site.status === WEBISTE_BLOCK_STATUS.ACTIVE) {
      playPauseButton.appendChild(document.createTextNode('||'));
      playPauseButton.title = 'Pause';
    } else {
      playPauseButton.appendChild(document.createTextNode('>'));
      playPauseButton.title = 'Resume';
      li.style.textDecoration = 'line-through';
    }
    playPauseButton.addEventListener('click', function () {
      updateWebsiteBlockStatus(site, function () {
        site.status = site.status === WEBISTE_BLOCK_STATUS.ACTIVE 
          ? WEBISTE_BLOCK_STATUS.INACTIVE 
          : WEBISTE_BLOCK_STATUS.ACTIVE;
        if (site.status === WEBISTE_BLOCK_STATUS.ACTIVE) {
          playPauseButton.title = 'Pause';
          playPauseButton.innerText = '||';
          li.style.textDecoration = 'none';
        } else {
          playPauseButton.title = 'Resume';
          playPauseButton.innerText = '>';
          li.style.textDecoration = 'line-through';
        }
        let currentWebsiteUrl = document.getElementById('websiteUrl').value;
        if (currentWebsiteUrl === site.hostname)
          refreshActiveTab();
      });
    });
    return playPauseButton;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    // since only one tab should be active and in the current window at once
    // the return variable should only have one entry
    let activeTab = tabs[0];
    let hostname = '';
    if (activeTab.url.includes('http') || activeTab.url.includes('https')) {
      hostname = new URL(activeTab.url).hostname;
      document.getElementById('websiteUrl').value = hostname;
    }

    if (hostname === '') {
      hideInfoWebsiteBlocked();
      return;
    }

    chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
      var blockedWebsites = data.blockedWebsites.map(site => site.hostname);
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
    var index = blockedWebsites.findIndex(x => x.hostname === websiteUrl);
    if (index > -1) {
      blockedWebsites.splice(index, 1);
      chrome.storage.local.set({ blockedWebsites: blockedWebsites }, function () {
        callback();
      });
    }
  });
}

function updateWebsiteBlockStatus(site, callback) {
  chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
    var blockedWebsites = data.blockedWebsites;
    var index = blockedWebsites.findIndex(x => x.hostname === site.hostname);
    if (index > -1) {
      blockedWebsites[index].status = 
        blockedWebsites[index].status === WEBISTE_BLOCK_STATUS.ACTIVE 
        ? WEBISTE_BLOCK_STATUS.INACTIVE 
        : WEBISTE_BLOCK_STATUS.ACTIVE;
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