// server.js
// where your node app starts

if (process.env.GIT_EMAIL) {
  require('child_process').execSync(`git config user.email ${process.env.GIT_EMAIL}`)
}

// init project
const express = require('express');
const app = express();

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get('/', function(request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
  console.log('Your app is listening on port ' + listener.address().port);
});

async function getGitHubClient() {
  const { App } = require("@octokit/app")
  const { request } = require("@octokit/request")

  const APP_ID = +process.env.GH_APP_ID
  const APP_INSTALLATION_ID = +process.env.GH_APP_ID
  const PRIVATE_KEY = Bprocess.env.GH_APP_PRIVATE_KEY

  const app = new App({ id: APP_ID, privateKey: PRIVATE_KEY })
  const jwt = app.getSignedJsonWebToken()

  // Example of using authenticated app to GET an individual installation
  // https://developer.github.com/v3/apps/#find-repository-installation
  const { data } = await request("GET /repos/:owner/:repo/installation", {
    owner: "hiimbex",
    repo: "testing-things",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github.machine-man-preview+json"
    }
  });

  const installationId = data.id;
}