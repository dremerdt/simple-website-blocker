document.addEventListener('DOMContentLoaded', function () {
    var blockedList = document.getElementById('blockedList');
  
    chrome.storage.sync.get({ blockedWebsites: [] }, function (data) {
      var blockedWebsites = data.blockedWebsites;
      blockedWebsites.forEach(function (site) {
        var li = document.createElement('li');
        li.textContent = site;
        blockedList.appendChild(li);
      });
    });
  });
  