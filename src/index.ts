import ky, { HTTPError } from "ky"

import { QComment, articleToMap, explodeArticle, explodeComment, fetchComments, fetchPosts, getCookie, getProfile, getRecentComments, mergeCookie, removeComment, sleep } from "./util.js"
import chalk from "chalk"
import Debug from "debug"
import fs from "node:fs/promises"

const debug = Debug("qcleaner:main")
const blacklistCat = ["qsz_qna", "qm_temporary"]

let cookie = await getCookie()

console.log(cookie)

// 프로필 확인
const profile = await getProfile(cookie)
cookie = mergeCookie(cookie, profile.setCookie)

debug(`유저이름: ${chalk.green(profile.nickName)}, 행성: ${chalk.red(profile.planet)}`)

// 최근 코멘트들 삭제
const recentComments = (await getRecentComments(cookie, profile.userId)).comments

for (let count = 0; count < recentComments.length; count += 1) {
  try {
    const comment = recentComments[count]

    const internalResp = await removeCommentInternal(comment, count)
    cookie = mergeCookie(cookie, internalResp.setCookie)

    if (!internalResp.result) {
      count -= 1
    }
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 429) {
      debug(`[Comment] 429 Too many requests. Retrying in 5 sec.`)
      await sleep(5000)
      count -= 1
      continue
    }
    console.error(err)
    break
  }
}

// 게시글 밀어버리기
const myPosts = await fetchPosts(cookie)
cookie = mergeCookie(cookie, myPosts.setCookie)
await sleep(2000)

const articleMap = articleToMap(myPosts.posts.filter((v) => !v.isComment))
for (const [boardName, value] of Object.entries(articleMap)) {
  if (blacklistCat.indexOf(boardName) >= 0) {
    continue
  }
  for (const articleId of value.values()) {
    debug(`[Article] Exploding article ${chalk.green(articleId)} (${chalk.yellow(boardName)})...`)
    const current = Date.now()
    const resp = await explodeArticle(cookie, {
      articleId,
      boardName,
    })
    await sleep(1600 - (Date.now() - current))
    cookie = mergeCookie(cookie, resp.setCookie)
  }
}

// 댓글 밀어버리기
const skipArticles = articleToMap(recentComments)
const totalComments = myPosts.posts.filter((v) => v.isComment)
const commentMap = articleToMap(totalComments)
let pungComments = recentComments.length

await sleep(2000)

for (const [boardName, value] of Object.entries(commentMap)) {
  if (blacklistCat.indexOf(boardName) >= 0) {
    continue
  }
  const skipCat = skipArticles[boardName] ?? new Set()
  for (const articleId of value.values()) {
    if (skipCat.has(articleId)) {
      continue
    }
    const cData = await fetchComments(cookie, {
      boardName,
      articleId,
    })
    cookie = mergeCookie(cookie, cData.setCookie)

    for (const comment of cData.commentsData) {
      if (comment.user_id !== profile.userId) {
        continue
      }
      const respInt = await removeCommentInternal({
        boardName,
        articleId,
        page: -1,
        commentId: `${comment.id}`,
      }, totalComments.length - pungComments)
      cookie = mergeCookie(cookie, respInt.setCookie)

      pungComments += 1
    }
  }
}

async function removeCommentInternal(comment: QComment, count: number) {
  debug(`[RemoveComment] Removing comment ${chalk.green(count + 1)}/${chalk.red(recentComments.length)}...`)

  let reqTime = Date.now()
  const result = await removeComment(cookie, comment)
  cookie = mergeCookie(cookie, result.setCookie)
  await sleep(800 - (Date.now() - reqTime))

  if (result.tmr) {
    debug(`[Comment] 429 Too many requests. Retrying in 5 sec.`)
    await sleep(5000)
    return {
      setCookie: cookie,
      result: false,
    }
  }

  if (!result.success && result.mustEdit) {
    reqTime = Date.now()
    const explodeR = await explodeComment(cookie, profile.CSRFToken, comment)
    cookie = mergeCookie(cookie, explodeR.setCookie)
    await sleep(400 - (Date.now() - reqTime))

    if (!explodeR.success) {
      debug(chalk.red(`Comment ${comment.commentId} explosion failed!!!`))
    } else {
      return {
        setCookie: cookie,
        result: true,
      }
    }
  }
  if (!result.success) {
    debug(chalk.red(`Comment ${comment.commentId} deletion failed!!!`) + ` - Reason: ${chalk.yellow(result.failReason)}`)
  } else {
    return {
      setCookie: cookie,
      result: true,
    }
  }
  return {
    setCookie: cookie,
    result: false,
  }
}