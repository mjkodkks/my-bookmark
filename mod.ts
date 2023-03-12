import { Application, Router } from "https://deno.land/x/oak@v12.1.0/mod.ts";
import "https://deno.land/std@0.179.0/dotenv/load.ts";
import { connect } from "https://deno.land/x/redis/mod.ts";

const redis = await connect({
    hostname: Deno.env.get("REDIS_HOSTNAME") || '',
    port: Deno.env.get("REDIS_PORT") || '',
    username: Deno.env.get("REDIS_USER") || '',
    password: Deno.env.get("REDIS_PASS") || ''
  });

const consumer_key = Deno.env.get("CONSUMER_KEY")
let codeAchive = ''
interface IBookmarkResponse {
    item_id: string
    resolved_id: string
    given_url: string
    given_title: string
    time_added: string
}

const router = new Router();
router
    .get("/", (context) => {
        context.response.body = "Hello World";
    })
    .get("/test-redis", async (context) => {
        const bookmarksString = await redis.get("bookmarks")
        // console.log(bookmarksString);
        const template = JSON.parse(bookmarksString || '')
        context.response.body = template;
    })
    .get("/bookmarks", async (context) => {
        try {
            if(!codeAchive) {
                console.log('on request')
                const getpocketRequestAuth = await fetch('https://getpocket.com/v3/oauth/request', {
                    method: 'POST',
                    body: JSON.stringify({
                        consumer_key,
                        redirect_uri: 'https://www.google.com'
                    }),
                    // important header
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Accept': 'application/json'
                    }
                })
                const { code, state } = await getpocketRequestAuth.json()
                codeAchive = code
            }
            
            console.log('codeAchive : ',  codeAchive)
            //   await fetch(`https://getpocket.com/auth/authorize?request_token=${code}&redirect_uri=http://www.google.com`)

            const getpocketAuth = await fetch('https://getpocket.com/v3/oauth/authorize', {
                method: 'POST',
                body: JSON.stringify({
                    consumer_key,
                    code: codeAchive
                }),
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Accept': 'application/json'
                }
            })
            if (getpocketAuth.status === 403) {
                console.log('case 403')
                const redirectUrl = context.request.url.href;
                console.log(redirectUrl);
                throw new Error(`https://getpocket.com/auth/authorize?request_token=${codeAchive}&redirect_uri=${Deno.env.get("REDIRECT_URL") || redirectUrl}`);
            }
            if (getpocketAuth.status === 200) {
                console.log('case 200')
                const { access_token } = await getpocketAuth.json();

                const getpocketGet = await fetch('https://getpocket.com/v3/get', {
                    method: 'POST',
                    body: JSON.stringify({
                        consumer_key,
                        access_token,
                        state: "all",
                        sort: "newest",
                        detailType: "simple",
                        favorite: "1"
                    }),
                    // important header
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Accept': 'application/json'
                    }
                })
                
                const { list } = await getpocketGet.json()
                const template = {
                    bookmark: []
                } as {bookmark: IBookmarkResponse[]}
                const len = Object.keys(list).length
                for (let i=0;i < len; i++ ) {
                    const { item_id, resolved_id, given_url, given_title, time_added } = list[Object.keys(list)[i]]
                    template.bookmark.push({
                            item_id,
                            resolved_id,
                            given_url,
                            given_title,
                            time_added,
                    })
                }
                redis.set('bookmarks', JSON.stringify(template))
                context.response.body = template
            }
        } catch (error) {
            context.response.body = {
                message: error.message
            }
        }
    })

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: 8000 });