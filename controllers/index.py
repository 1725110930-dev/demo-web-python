import web

render = web.template.render('views', base='layout')


class Index:
    def GET(self):
        return render.index()