if (process.env.GIT_EMAIL) {
  require('child_process').execSync(`git config user.email ${process.env.GIT_EMAIL}`)
}

const { App } = require('@octokit/app')
const Octokit = require('@octokit/rest')
const express = require('express');
const basicAuth = require('express-basic-auth')
const app = express();
const prettier = require('prettier')
require('longjohn');

// https://github.com/bemusic/bemuse/blob/master/.prettierrc
const prettierConfig = {
  "singleQuote": true,
  "semi": false,
  "proseWrap": "always",
  "trailingComma": "es5",
  "jsxSingleQuote": true
}

const authenticated = basicAuth({
  users: { admin: process.env.ADMIN_PASSWORD },
  challenge: true,
  realm: 'bemuse-release-train',
})

app.use(authenticated)
app.use(express.static('public'))

const owner = 'bemusic'
const repo = 'bemuse'

app.get('/changelog', async function(req, res, next) {
  try {
    const gh = getGitHubClient()
    const log = console.log

    // Fetch the pull requests
    const pullsResponse = await gh.pulls.list({
      owner,
      repo,
      per_page: 100,
      sort: 'created',
      direction: 'asc',
    })
    
    // Fetch existing changelog
    const changelogResponse = await gh.repos.getContents({
      owner,
      repo,
      path: 'CHANGELOG.md'
    })
    const existingChangelog = Buffer.from(changelogResponse.data.content, 'base64').toString()

    const pullsToPrepare = pullsResponse.data.filter(p => p.labels.map(l => l.name).includes('c:ready'))
    const markdown = updateChangelog(existingChangelog, pullsToPrepare)
    const htmlResponse = await gh.markdown.render({
      text: markdown,
      context: `${owner}/${repo}`
    })
    res.send(htmlResponse.data)
  } catch (e) {
    next(e)
  }
})

const indent = require('indent-string')
const _ = require('lodash')

function updateChangelog(existingChangelog, pulls, version = 'UNRELEASED') {
  const userListRegExp = /((?:\[@\w+\]: https.+\n)+)/
  const userList = existingChangelog.match(userListRegExp)

  const existingUsers = new Set()
  userList[1].replace(/@(\w+)/g, (a, id) => {
    existingUsers.add(id.toLowerCase())
  })

  const pullMap = new Map()
  const newUsers = new Map()
  const registerUser = u => {
    if (!existingUsers.has(u.toLowerCase())) newUsers.set(u.toLowerCase(), u)
    return `[@${u}]`
  }
  const bullets = pulls
    .map(p => ({
      match: p.body.match(/### Changelog\s*\n([^]+)/),
      pull: p,
    }))
    .filter(x => x.match)
    .map(x => {
      pullMap.set(x.pull.number, x.pull)
      const text = x.match[1].trim().replace(/\[@([^\]\s]+)\]/, (a, id) => {
        return registerUser(id)
      })
      return {
        text: `- ${indent(text, 2).substr(2)} [#${x.pull.number}], by ${registerUser(x.pull.user.login)}`,
        category: (x.pull.labels.find(l => l.name.startsWith('category:')) || { name: 'category:Others' }).name.replace(/category:/, ''),
      }
    })
  const bulletPoints = _.chain(bullets)
    .groupBy(b => b.category)
    .map((v, k) => {
      return {
        text: `### ${k}\n\n` + v.map(b => b.text).join('\n'),
        order: (['New stuff'].indexOf(k) + 1) || 999999,
      }
    })
    .sortBy(b => b.order)
    .value()
    .map(c => c.text)
    .join('\n\n')
  const pullRefs = [...pullMap].map(([number, pull]) => `[#${number}]: ${pull.html_url}`).join('\n')
  const newUserRefs = [...newUsers].map(([k, u]) => `[@${k}]: https://github.com/${u}`).join('\n')
  const newMarkdown = `## ${version}\n\n${bulletPoints}\n\n${pullRefs}`
  let markdown = existingChangelog
    .replace(userListRegExp, a => {
      return a + newUserRefs + '\n'
    })
    .replace(/## /, a => {
      return newMarkdown + '\n\n' + a
    })
  return prettier.format(markdown, { ...prettierConfig, parser: 'markdown' })
}

app.post('/prepare/:version', async function(req, res, next) {
  try {
    const gh = getGitHubClient()
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

    // Existing pull request for release
    const existingPull = pullsResponse.data.find(p => p.head.ref === 'release-train/proposed')

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
    const mergedPulls = []
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
        mergedPulls.push(pull)
      } catch (e) {
        log(`Failed to merge pull request #${pull.number}: ${e}`)
      }
    }

    // Update changelog
    const changelogResponse = await gh.repos.getContents({
      owner,
      repo,
      path: 'CHANGELOG.md',
      ref: headSha,
    })
    const existingChangelog = Buffer.from(changelogResponse.data.content, 'base64').toString()
    const version = req.params.version.replace(/^(\d)/, 'v$1')
    const newChangelog = updateChangelog(existingChangelog, mergedPulls, version)
    const changelogUpdateResponse = await gh.repos.createOrUpdateFile({
      owner,
      repo,
      path: 'CHANGELOG.md',
      message: 'Update changelog',
      content: Buffer.from(newChangelog).toString('base64'),
      branch: 'release-train/prepare',
      sha: changelogResponse.data.sha,
    })
    headSha = changelogUpdateResponse.data.commit.sha
    log(`Updated changelog -> ${headSha}`)

    // Update package version

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

    if (existingPull) {
      await gh.pulls.update({
        owner,
        repo,
        pull_number: existingPull.number,
      })
    } else {
      await gh.pulls.create({
        owner,
        repo,
        title: version,
        head: 'release-train/proposed',
        base: 'master',
      })
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