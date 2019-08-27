if (process.env.GIT_EMAIL) {
  require('child_process').execSync(`git config user.email ${process.env.GIT_EMAIL}`)
}

const { App } = require('@octokit/app')
const Octokit = require('@octokit/rest')
const express = require('express');
const basicAuth = require('express-basic-auth')
const app = express();
require('longjohn');

app.use(basicAuth({
  users: { admin: process.env.ADMIN_PASSWORD }
}))

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
      ref: 'heads/master'
    })
    const masterSha = masterResponse.data.object.sha
    log(`master branch is at ${masterSha}`)
    if (!masterSha) {
      throw new Error('Expected masterSha to exist')
    }
    await gh.git.createRef({
      owner, repo,
      ref: 'refs/heads/release-train/prepare',
      sha: masterSha
    })

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
        log(`Merged pull request #${pull.number} from ${pull.head.ref} -> ${headSha}`)
      } catch (e) {
        log(`Failed to merge pull request #${pull.number}: ${e}`)
      }
    }

    // Update the proposed branch
    const forcePushRef = async (ref, sha) => {
      try {
        log(`Updating ref ${ref} -> ${sha}`)
        await gh.git.updateRef({ owner, repo, ref, sha, force: true })
      } catch (e) {
        if (e.status === 422) {
          log(`422 - Creating ref ${ref} -> ${sha}`)
          await gh.git.createRef({ owner, repo, ref: 'refs/' + ref, sha })
        } else {
          throw e
        }
      }
    }

    log(`Updating proposed branch`)
    await forcePushRef('heads/release-train/proposed', headSha)

    log(`Deleting preparation branch`)
    await gh.git.deleteRef({
      owner, repo,
      ref: 'heads/release-train/prepare',
    })

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