package activities

type Orders struct {
	Prefix string
}

func (o *Orders) Load(id string) (string, error) {
	return o.Prefix + id, nil
}

func (o *Orders) privateReceipt(id string) (string, error) {
	return o.Prefix + id, nil
}
