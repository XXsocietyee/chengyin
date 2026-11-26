Component({
  properties: {
    model: { type: Object, value: null },
  },
  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
