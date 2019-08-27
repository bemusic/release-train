if (process.env.GIT_EMAIL) {
  require('child_process').execSync(`git config user.email ${process.env.GIT_EMAIL}`)
}

const { App } = require('@octokit/app')
const Octokit = require('@octokit/rest')

const express = require('express');
const app = express();

app.use(express.static('public'));

app.post('/prepare', async function(req, res, next) {
  try {
    const gh = getGitHubClient()
    const owner = 'bemusic'
    const repo = 'bemuse'
    const log = console.log

    // Fetch the pull requests
    const pullsResponse = await gh.pulls.list({
      owner,
      repo,
      per_page: 100,
      sort: 'created',
      direction: 'asc',
    })
    log(`Pull requests fetched: ${pullsResponse.data.length}`)

    const pullsToPrepare = pullsResponse.data.filter(p => p.labels.map(l => l.name).includes('c:ready'))
    log(`Pull requests to prepare: ${pullsToPrepare.length}`)

    // Create a preparation branch
    const masterResponse = await gh.git.getRef({
      owner,
      repo,
      ref: 'refs/heads/master'
    })
    lo
    try {
      await gh.git.deleteRef({
        owner,
        repo,
        ref: 'refs/heads/release-train/prepare'
      })
    } catch (e) {
    }

    for (const pull of pullsToPrepare) {
      log(`Preparing pull request #${pull.number}`)
    }

    res.send('OK!')
  } catch (e) {
    next(e)
  }
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
  console.log('Your app is listening on port ' + listener.address().port);
});

function getGitHubClient() {
  const app = new App({ id: process.env.GH_APP_ID, privateKey: Buffer.from(process.env.GH_APP_PRIVATE_KEY_BASE64, 'base64').toString() })
  const octokit = new Octokit({
    async auth () {
      const installationAccessToken = await app.getInstallationAccessToken({ 
        installationId: process.env.GH_APP_INSTALLATION_ID 
      });
      return `token ${installationAccessToken}`;
    }
  })
  return octokit
}