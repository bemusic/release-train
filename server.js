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
    const masterSha = masterResponse.data.object.sha
    log(`master branch is at ${masterSha}`)
    if (!masterSha) {
      throw new Error('Expected masterSha to exist')
    }
    await forcePushRef('refs/heads/release-train/prepare', masterSha)

    // Merge each PR to this branch
    let headSha = masterSha
    for (const pull of pullsToPrepare) {
      log(`Preparing pull request #${pull.number}`)
      try {
        const mergeResponse = await gh.repos.merge({
          owner,
          repo,
          base: 'release-train/prepare',
          head: pull.head.ref,
          commit_message: `Merge pull request #${pull.number} from ${pull.head.ref}`,
        })
        headSha = mergeResponse.data.sha
        if (!headSha) {
          throw new Error('Expected headSha to exist')
        }
      } catch (e) {
        log(`Failed to merge pull request #${pull.number}: ${e}`)
      }
    }

    // Update the proposed branch
    const forcePushRef = async (ref, sha) => {
      try {
        await gh.git.updateRef({ owner, repo, ref, sha, force: true })
      } catch (e) {
        if (e.status === 404) {
          await gh.git.createRef({ owner, repo, ref, sha })
        } else {
          throw e
        }
      }
    }
    await forcePushRef('refs/heads/release-train/proposed', headSha)

    // 

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